'use strict';
/**
 * electron-builder afterPack hook — stamp the Windows app exe's icon and
 * version info WITHOUT Wine.
 *
 * electron-builder's default path shells out to `wine rcedit.exe` to embed the
 * icon and version strings into the packaged executable. Wine's Windows-service
 * startup deadlocks in some headless/CI sandboxes, which hangs the whole build.
 * With `win.signAndEditExecutable: false` electron-builder skips that step, and
 * this hook does the same work with `resedit` — a pure-JavaScript PE resource
 * editor — so the build is fast, reproducible, and Wine-free on any host.
 *
 * Runs after the app is unpacked into appOutDir but before the nsis/portable
 * targets consume it, so the installers pick up the already-branded exe.
 */
const fs = require('node:fs');
const path = require('node:path');
const ResEdit = require('resedit');

const LANG = 1033;      // en-US
const CODEPAGE = 1200;  // Unicode

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const productName = context.packager.appInfo.productFilename; // "Go Back To The Sandbox"
  const exePath = path.join(context.appOutDir, `${productName}.exe`);
  const icoPath = path.join(__dirname, 'icon.ico');
  if (!fs.existsSync(exePath)) throw new Error(`afterPack: exe not found at ${exePath}`);
  if (!fs.existsSync(icoPath)) throw new Error(`afterPack: icon.ico not found at ${icoPath}`);

  const version = context.packager.appInfo.version; // "2.5.0"
  const [maj = 0, min = 0, patch = 0] = version.split('.').map((n) => parseInt(n, 10) || 0);

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);

  // ---- icon: replace the existing icon group with our multi-size .ico ------
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const existingGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = existingGroups.length ? existingGroups[0].id : 1;
  const groupLang = existingGroups.length ? existingGroups[0].lang : LANG;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    groupId,
    groupLang,
    iconFile.icons.map((i) => i.data),
  );

  // ---- version info --------------------------------------------------------
  const existingVi = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = existingVi.length ? existingVi[0] : ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(maj, min, patch, 0, LANG);
  vi.setProductVersion(maj, min, patch, 0, LANG);
  vi.setStringValues(
    { lang: LANG, codepage: CODEPAGE },
    {
      ProductName: 'Go Back To The Sandbox',
      FileDescription: 'Go Back To The Sandbox — zombie wave survival FPS',
      CompanyName: 'Sandbox Defense Network',
      LegalCopyright: 'Copyright © Sandbox Defense Network',
      ProductVersion: version,
      FileVersion: version,
      InternalName: productName,
      OriginalFilename: `${productName}.exe`,
    },
  );
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));

  console.log(`  • afterPack: stamped icon + version (${version}) into ${path.basename(exePath)} via resedit (no Wine)`);
};
