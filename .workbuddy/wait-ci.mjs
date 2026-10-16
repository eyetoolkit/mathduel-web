// 轮询 GitHub Actions：等 06e37ab 的 build-gate workflow 全部 job 完成
const TOKEN = process.env.GH_PAT || process.env.GH_TOKEN || process.env.GITHUB_PAT_EYETOOLKIT || '';
const SHA = '06e37ab';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let i = 1; i <= 40; i++) {
    const r = await fetch('https://api.github.com/repos/eyetoolkit/mathduel-web/actions/runs?branch=main&per_page=5', {
      headers: TOKEN ? { Authorization: `token ${TOKEN}` } : {},
    });
    const j = await r.json();
    const runs = (j.workflow_runs || []).filter((x) => x.head_sha.startsWith(SHA));
    if (runs.length) {
      // 一个 workflow run 一个结论；inmatch-gate 是 job，需要查 jobs API
      for (const run of runs) {
        const jr = await (await fetch(`https://api.github.com/repos/eyetoolkit/mathduel-web/actions/runs/${run.id}/jobs`, {
          headers: TOKEN ? { Authorization: `token ${TOKEN}` } : {},
        })).json();
        const jobs = (jr.jobs || []).map((x) => `${x.name}=${x.status}/${x.conclusion || '-'}`).join('  ');
        const done = (jr.jobs || []).every((x) => x.status === 'completed');
        console.log(`[${i}] run ${run.id} ${jobs}`);
        if (done) {
          const bad = (jr.jobs || []).filter((x) => x.conclusion !== 'success');
          console.log(bad.length ? `FAILED_JOBS: ${bad.map((x) => x.name + ':' + x.conclusion).join(',')}` : 'ALL_JOBS_SUCCESS');
          process.exit(bad.length ? 1 : 0);
        }
      }
    } else {
      console.log(`[${i}] no runs for ${SHA} yet`);
    }
    await sleep(15000);
  }
  console.log('TIMEOUT waiting for CI');
  process.exit(2);
})();
