// Publishing: a site or funnel runs on this computer first (localhost), as a LucianOS job;
// once you enter a server's details it is copied there and started the same way. The
// program is the same in both places: one SWI-Prolog file (plus its saved data).

// Run a Tabler site: swipl site.pl PORT
export const runSiteSpec = ({ file, cwd = '', port = 8095 }) => ({ cmd: 'swipl', args: [file, String(port)], cwd, label: `Tabler site on port ${port}` });

// Convert a funnel's terminal program with vetusiapl2webpl. The file arguments come after
// "--" so swipl reads them as arguments rather than loading them as program files.
export const convertFunnelSpec = ({ vetusia, input, output, port = 8097, cwd = '' }) => ({
  cmd: 'swipl', args: ['-q', '-g', 'main', '-s', `${vetusia.replace(/\/$/, '')}/src/vetusia_converter.pl`, '--', input, '-o', output, '--port', String(port)], cwd, label: 'vetusiapl2webpl: funnel to web server'
});
export const runFunnelSpec = ({ file, cwd = '', port = 8097 }) => ({ cmd: 'swipl', args: [file], cwd, label: `Funnel on port ${port}` });

// Remote: the commands scripts/deploy.mjs runs (ssh and scp from your computer).
export function deployPlan({ host, user = '', dir = 'lucianoffice-sites', port = 8095, files = [], run, sshPort = 22 }) {
  if (!host) throw new Error('enter the server\'s address');
  if (!run) throw new Error('nothing to run');
  if (!/^[A-Za-z0-9._-]+$/.test(host) || (user && !/^[A-Za-z0-9._-]+$/.test(user))) throw new Error('the server address and user can only have letters, digits, dots, dashes and underscores');
  if (!/^[A-Za-z0-9._\/-]+$/.test(dir) || dir.includes('..')) throw new Error('the folder on the server can only have letters, digits, dots, dashes, underscores and slashes');
  const target = user ? `${user}@${host}` : host;
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const name = run.split('/').pop();
  const steps = [
    { cmd: 'ssh', args: ['-p', String(sshPort), target, `mkdir -p ${q(dir)}`], about: `make the folder ${dir} on ${host}` },
    { cmd: 'scp', args: ['-P', String(sshPort), ...files, `${target}:${dir}/`], about: `copy ${files.length} file${files.length === 1 ? '' : 's'}` },
    // stop the old copy (if any) and start the new one in the background, logging to the folder
    { cmd: 'ssh', args: ['-p', String(sshPort), target, `cd ${q(dir)} && (pkill -f ${q(`swipl ${name}`)} || true) && nohup swipl ${q(name)} ${Number(port)} > ${q(`${name}.log`)} 2>&1 &`], about: `start ${name} on port ${port}` }
  ];
  return { steps, url: `http://${host}:${port}/` };
}
