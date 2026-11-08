// Copies a site or funnel to your server and starts it there (ssh and scp from this computer).
// The plan comes on standard input (see lib/publish.js deployPlan); --dry-run prints it only.
//   echo '{"host":"example.com","user":"me","files":["site.pl"],"run":"site.pl","port":8095}' | node scripts/deploy.mjs --dry-run
import { spawn } from 'node:child_process';
import { deployPlan } from '../lib/publish.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const dry = process.argv.includes('--dry-run');
try {
  const plan = deployPlan(JSON.parse(input));
  for (const step of plan.steps) {
    process.stdout.write(`${dry ? 'WOULD RUN' : 'RUN'} ${step.about}: ${step.cmd} ${step.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
    if (dry) continue;
    const code = await new Promise((resolve) => {
      const child = spawn(step.cmd, step.args, { stdio: ['ignore', 'inherit', 'inherit'] });
      child.on('error', (err) => { process.stdout.write(`${step.cmd}: ${err.message}\n`); resolve(127); });
      child.on('close', resolve);
    });
    if (code !== 0) throw new Error(`${step.about} failed (exit ${code})`);
  }
  process.stdout.write(`DEPLOYED ${plan.url}\n`);
} catch (err) {
  process.stdout.write(`DEPLOY_ERROR ${err.message}\n`);
  process.exitCode = 1;
}
