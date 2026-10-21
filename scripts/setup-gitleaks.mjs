// Adapted from dataarthub/appkit MIT maintenance tooling. Copyright ALNEAS.
import {mkdirSync,mkdtempSync,writeFileSync,chmodSync,renameSync,rmSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {gitleaksVersion,gitleaksChecksums,localGitleaks} from './quality-tools.mjs';
let temporary;
try {
  const platform = process.platform + '_' + process.arch;
  const expected = gitleaksChecksums[platform];
  if (!expected) throw Error('Local installer supports macOS/Linux on arm64/x64. Install the pinned Gitleaks version separately on other platforms.');
  mkdirSync(path.dirname(localGitleaks), {recursive: true});
  temporary = mkdtempSync(path.join(path.dirname(localGitleaks), 'install-'));
  const filename = `gitleaks_${gitleaksVersion}_${platform}.tar.gz`;
  const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${gitleaksVersion}/${filename}`, {signal: AbortSignal.timeout(60000)});
  if (!response.ok) throw Error('Official Gitleaks download failed: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 64 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('Gitleaks archive SHA-256 mismatch');
  const archive = path.join(temporary, 'release.tar.gz');
  writeFileSync(archive, bytes);
  execFileSync('tar', ['-xzf', archive, '-C', temporary, 'gitleaks'], {stdio: 'pipe'});
  const binary = path.join(temporary, 'gitleaks');
  chmodSync(binary, 0o755);
  if (execFileSync(binary, ['version'], {encoding: 'utf8'}).trim() !== gitleaksVersion) throw Error('Gitleaks version mismatch');
  renameSync(binary, localGitleaks);
  console.log(`Installed verified Gitleaks ${gitleaksVersion} in ignored .verification/tools/gitleaks/.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, {recursive: true, force: true});
}
