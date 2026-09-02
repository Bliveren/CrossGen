#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OWNER = process.env.CROSSGEN_GITHUB_OWNER || 'Bliveren';
const REPO = process.env.CROSSGEN_GITHUB_REPO || 'CrossGen';
const outputArgIndex = process.argv.indexOf('--output');
const outputPath = outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
  ? resolve(process.argv[outputArgIndex + 1])
  : resolve('docs/growth/metrics/latest.json');

function readJson(endpoint) {
  const resource = endpoint ? `repos/${OWNER}/${REPO}/${endpoint}` : `repos/${OWNER}/${REPO}`;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    return fetch(`https://api.github.com/${resource}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`GitHub API ${response.status} for ${endpoint || 'repository'}`);
      return response.json();
    });
  }

  try {
    const raw = execFileSync('gh', ['api', resource], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return Promise.resolve(JSON.parse(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Promise.reject(new Error(`No authenticated GitHub client for ${endpoint || 'repository'}: ${message}`));
  }
}

async function collect(endpoint) {
  try {
    return { status: 'ok', data: await readJson(endpoint) };
  } catch (error) {
    return { status: 'unavailable', error: error instanceof Error ? error.message : String(error) };
  }
}

const [repository, releases, views, clones, referrers, community] = await Promise.all([
  collect(''),
  collect('releases?per_page=20'),
  collect('traffic/views'),
  collect('traffic/clones'),
  collect('traffic/popular/referrers'),
  collect('community/profile'),
]);

const releaseData = releases.status === 'ok' && Array.isArray(releases.data)
  ? releases.data.map((release) => ({
      tag: release.tag_name,
      name: release.name,
      publishedAt: release.published_at,
      draft: release.draft,
      prerelease: release.prerelease,
      assets: Array.isArray(release.assets)
        ? release.assets.map((asset) => ({ name: asset.name, downloads: asset.download_count, size: asset.size }))
        : [],
    }))
  : releases;

const result = {
  schemaVersion: 1,
  collectedAt: new Date().toISOString(),
  repositoryId: `${OWNER}/${REPO}`,
  source: 'GitHub REST API via authenticated token or gh CLI',
  repository: repository.status === 'ok'
    ? {
        name: repository.data.full_name,
        stars: repository.data.stargazers_count,
        forks: repository.data.forks_count,
        openIssues: repository.data.open_issues_count,
        watchers: repository.data.watchers_count,
        updatedAt: repository.data.updated_at,
        pushedAt: repository.data.pushed_at,
        latestRelease: Array.isArray(releaseData) ? releaseData[0]?.tag ?? null : null,
      }
    : repository,
  releases: releaseData,
  traffic: { views, clones, referrers },
  community,
  notes: [
    'Traffic endpoints require authenticated GitHub access and may be unavailable for unauthenticated runs.',
    'Release asset downloads include blockmap and auxiliary files; do not treat the total as unique users.',
    'Compare stars and traffic using the same collection window before calculating conversion rates.',
  ],
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: outputPath, repository: result.repository, trafficAvailable: views.status === 'ok' }, null, 2));
