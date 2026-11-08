// The request a script gets on standard input: one line of JSON. LucianOS jobs keep their
// input open (text arrives with api.jobs.input), so the first line is read, not the whole stream.
export function readRequest() {
  return new Promise((resolve, reject) => {
    let buf = '';
    const done = (text) => { process.stdin.pause(); process.stdin.unref?.(); process.stdin.destroy(); try { resolve(JSON.parse(text)); } catch (err) { reject(new Error(`the request is not JSON: ${err.message}`)); } };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl >= 0) { process.stdin.removeAllListeners('end'); done(buf.slice(0, nl)); }
    });
    process.stdin.on('end', () => done(buf));
  });
}
