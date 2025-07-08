const os = require("os");
const sudo = require("@vscode/sudo-prompt");
const fs = require("fs");
const lzma = require("lzma-native");
const https = require("https");
const { spawn, exec } = require('child_process');
const { execSync } = require('child_process');
const { stderr, stdout } = require("process");
const tar = require("tar");
const path = require('path');

const vmimgpath =
  // "/home/m/Desktop/VirtualBoxes/ubuntu/ubuntu.qcow2"
  "VMIMAGE.qcow2";
const biospath = "bios.efi";

const vmxzpath = "VMIMAGE.qcow2.xz";

const biosurl = ""
const arm64imgurl = "";

const x86_64imgurl = "https://localhost:8443/testfile";

const qemuurl = "https://localhost:8443/testfile";
const qemupath = "qemu";
const qemuxzpath = "qemu.tar.xz";
const qemutarpath = "qemu.tar";

const authorize = false;
const RAMRATIO = 3;

function fileExists(fpath) {
  try {
    return fs.existsSync(fpath) && fs.statSync(fpath).isFile();
  } catch (err) {
    return false;
  }
}

function dirExists(fpath) {
  try {
    return fs.existsSync(fpath) && fs.statSync(fpath).isDirectory();
  } catch (err) {
    return false;
  }
}

module.exports = class Platform {
  arch;
  platform;
  ramsize;

  getAppDataDir(appName) {
    const home = os.homedir();
    let basedir;
    if (this.platform === 'win32') {
      basedir = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    } else if (this.platform === 'darwin') {
      basedir = path.join(home, 'Library', 'Application Support');
    } else {
      basedir = path.join(home, '.config');
    }
    const appdir = path.join(basedir, appName);
    if (!fs.existsSync(appdir)) {
      fs.mkdirSync(appdir, { recursive: true });
      console.log('Created app data directory:', appdir);
    }
    return appdir;
  }

  extractStuff(xzpath, outpath, ep = null) {
    return new Promise((resolve, reject) => {
      fs.writeFileSync(outpath, "");
      const input = fs.createReadStream(xzpath);
      const output = fs.createWriteStream(outpath);
      const totalsize = fs.statSync(xzpath).size;
      let processedbytes = 0;
      input.on('data', (chunk) => {
        processedbytes += chunk.length;
        const percent = ((processedbytes / totalsize) * 100).toFixed(2);
        process.stdout.write(`\rDecompressing ${path.basename(xzpath)}: ${percent}%`);
        if (ep) ep(`\rDecompressing ${path.basename(xzpath)}: ${percent}%`);
      });
      input.on('error', reject);
      output.on('error', reject);
      const decompressor = lzma.createDecompressor();
      decompressor.on('error', reject);
      output.on('finish', () => {
        fs.unlink(xzpath, () => { });
        resolve();
      });
      input.pipe(decompressor).pipe(output);
    })
  }

  extractImage(xzpath, outpath, ep) {
    return this.extractStuff(xzpath, outpath, ep);
  }

  switchArch() {
    switch (this.arch) {
      case "arm64":
      case "x64":
        return true;
    }
    return false;
  }

  downloadStuff(url, outputpath, dp = null) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(outputpath);
      https.get(url, { rejectUnauthorized: authorize }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Request Failed. Status Code: ${response.statusCode}`));
          return;
        }
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        response.on('data', chunk => {
          downloadedSize += chunk.length;
          if (!isNaN(totalSize)) {
            const percent = ((downloadedSize / totalSize) * 100).toFixed(2);
            process.stdout.write(`\rDownloading ${path.basename(outputpath)}: ${percent}%`);
            if (dp) dp(`\rDownloading ${path.basename(outputpath)}: ${percent}%`);
          } else {
            process.stdout.write(`\rDownloading ${path.basename(outputpath)}: ${downloadedSize} bytes`);
            if (dp) dp(`\rDownloading ${path.basename(outputpath)}: ${downloadedSize} bytes`);
          }
        });
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(outputpath, () => { });
        reject(err);
      });
    });
  }

  getQemuXzPath() {
    return path.join(this.appdatadir, qemuxzpath);
  }

  getQemuTarPath() {
    return path.join(this.appdatadir, qemutarpath);
  }

  getQemuPath() {
    return path.join(this.appdatadir, qemupath);
  }

  getxzPath() {
    return path.join(this.appdatadir, vmxzpath);
  }

  getImagePath() {
    return path.join(this.appdatadir, vmimgpath);
  }

  getBiosPath() {
    return path.join(this.appdatadir, biospath);
  }

  async downloadImage(outputpath, dp) {
    if (!this.switchArch()) throw new Error("Unsupported architecture");
    const url = this.arch === "arm64" ? arm64imgurl : x86_64imgurl;
    await this.downloadStuff(url, outputpath, dp);
  }


  commandExists(command) {
    try {
      execSync(`command -v ${command}`, { stdio: 'ignore' });
      return true
    } catch {
      return false;
    }
  }

  getLinuxPMCommand(pm, qemupkg) {
    switch (pm) {
      case 'apt':
        return `apt-get install -y ${qemupkg}`;
      case 'dnf':
        return `dnf install -y ${qemupkg}`;
      case 'pacman':
        return `pacman -Sy --noconfirm ${qemupkg}`;
      case 'zypper':
        return `zypper install -y ${qemupkg}`;
      default:
        throw new Error('Unsupported package manager.');
    }
  }

  getLinuxQemuPkg() {
    let pkgs = [];
    // if (!this.commandExists("qemu-img")) {
    //   pkgs.push("qemu-utils");
    // }
    switch (this.arch) {
      case "arm64": {
        if (!this.commandExists("qemu-system-aarch64")) {
          pkgs.push("qemu-system-aarch64");
        }
        break;
      }
      case "x64": {
        if (!this.commandExists("qemu-system-x86_64")) {
          pkgs.push("qemu-system-x86");
        }
        break;
      }
      default:
        throw new Error("Unsupported architecture");
    }
    return pkgs.length > 0 ? pkgs.join(" ") : "";
  }

  getLinuxPM() {
    const managers = ['apt', 'dnf', 'pacman', 'zypper', 'yum'];
    for (const pm of managers) {
      if (this.commandExists(pm)) {
        return pm;
      }
    }
    return null;
  }

  async installQemuLinux(dp = null) {
    const pkgs = this.getLinuxQemuPkg();
    if (pkgs === "") {
      console.log("qemu already installed..\n");
      if (dp) dp("qemu already installed..\n");
      return;
    }//already installed
    const pkgcommand = this.getLinuxPMCommand(this.getLinuxPM(), pkgs);
    console.log("Installing QEMU");
    if (dp) dp("Installing QEMU...");
    await new Promise((resolve, reject) => {
      sudo.exec(pkgcommand, { name: "Install QEMU" }, (err, stdout, stderr) => {
        if (err) {
          if (dp) dp(err.message);
          reject(err);
          return;
        }
        if (stderr) {
          console.warn(stderr);
          if (dp) dp(stderr)
        }
        if (this.getLinuxQemuPkg() !== "") {
          if (dp) dp("Failed to install QEMU. Please check your internet connection.");
          reject(new Error("Failed to install QEMU"));
        } else {
          if (dp) dp("QEMU has been installed.");
          resolve();
        }
      });
    })
  }

  whpxEnabled(dp = null) {
    if (dp) dp("Checking if whpx is on...")
    return new Promise((resolve, reject) => {
      exec("dism /online /Get-FeatureInfo /FeatureName:HypervisorPlatform", { shell: "cmd.exe" }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        if (stdout && stdout.includes("State : Disabled")) {
          if (dp) dp("whpx is off...")
          resolve(false);
        } else {
          if (dp) dp("whpx is on...")
          resolve(true);
        }
      })
    })
  }

  enableWhpx() {
    return new Promise((resolve, reject) => {
      if (dp) dp("Turning whpx on...")
      sudo.exec("dism /online /Enable-Feature /FeatureName:HypervisorPlatform /All /NoRestart", { name: "Enable Windows Hypervisor Platform" }, (err, stderr) => {
        if (err) {
          console.error(stderr);
        }
        if (stderr) {
          console.warn(stderr);
        }
        resolve();
      })
    })
  }

  async installQemuWindows(dp = null) {
    if (!await this.whpxEnabled(dp)) {
      await this.enableWhpx(dp);
      if (!await this.whpxEnabled()) throw new Error("Failed to enable wphx");
    }
    if (!dirExists(this.getQemuPath())) {
      fs.mkdirSync(this.getQemuPath(), { recursive: true });
    } else {
      if (dp) dp("QEMU is already installed...");
      return;
    }
    await this.downloadStuff(qemuurl, this.getQemuXzPath(), dp);
    await this.extractStuff(this.getQemuXzPath(), this.getQemuTarPath(), dp);
    await new Promise((resolve, reject) => {
      let filecnt = 0;
      tar.x({
        file: this.getQemuTarPath(),
        onentry: (entry) => {
          filecnt += 1;
          process.stdout.write(`\r[${filecnt}] Extracting ${entry.path}`);
          if (dp) dp(`\r[${filecnt}] Extracting ${entry.path}`);
        },
        C: this.appdatadir,
      }).then(() => {
        fs.unlink(this.getQemuTarPath(), () => { });
        resolve();
      }).catch(reject);
    })
  }

  installQemu(dp = null) {
    switch (this.platform) {
      case "linux":
        return this.installQemuLinux(dp);
      case "win32":
        return this.installQemuWindows(dp);
      default:
        throw new Error("Unsupported platform");
    }
  }

  async prepareVM(dp) {
    console.log("preparing vm....");
    dp("Getting Virtual Machine ready...");
    if (!fileExists(this.getImagePath())) {
      await this.downloadImage(this.getxzPath(), dp);
      if (this.arch === "arm64" && this.platform !== "win32") {
        this.downloadStuff(biosurl, this.getBiosPath(), dp);
      }
      await this.extractImage(this.getxzPath(), this.getImagePath(), dp);
    }
    await this.installQemu(dp);
  }

  linuxQemuCommand() {
    switch (this.arch) {
      case "arm64":
        return "qemu-system-aarch64"
      case "x64": {
        return "qemu-system-x86_64";
      }
      default:
        throw new Error("Unsupported architecture");
    }
  }

  runVMLinux() {
    const ram =
      Math.round(this.ramsize / RAMRATIO) * 1024;
    const qemu =
      this.arch === "x64" ?
        spawn("qemu-system-x86_64", [
          '-m', `${ram}`,
          '-hda', this.getImagePath(),
          '-enable-kvm',
          '-net', 'nic',
          '-net', 'user'
        ], { stdio: 'inherit' }) : spawn('qemu-system-aarch64', [
          '-monitor', 'stdio',
          '-M', 'virt,highmem=off',
          '-accel', 'kvm',
          '-cpu', 'host',
          '-m', `${ram}`,
          '-bios', this.getBiosPath(),
          '-device', 'virtio-gpu-pci',
          '-display', 'default,show-cursor=on',
          '-device', 'qemu-xhci',
          '-device', 'usb-kbd',
          '-device', 'usb-tablet',
          '-device', 'intel-hda',
          '-device', 'hda-duplex',
          '-drive', `file=${this.getImagePath()},format=qcow2,if=virtio,cache=writethrough`
        ], { stdio: 'inherit' });

    qemu.on('exit', (code) => {
      console.log(`QEMU exited with code ${code}`);
    });

    if (qemu.stderr && qemu.stdout) {
      qemu.stdout.on('data', (data) => {
        console.log(`QEMU STDOUT: ${data}`);
      });

      qemu.stderr.on('data', (data) => {
        console.error(`QEMU STDERR: ${data}`);
      });
    }
    qemu.on('close', (code) => {
      console.log(`QEMU exited with code ${code}`);
    });
  }

  runVMWindows(db = null) {
    const ram =
      Math.round(this.ramsize / RAMRATIO) * 1024;
    const qemu =
      this.arch === "x64" ?
        spawn(`${this.getQemuPath()}\\qemu-system-x86_64.exe`, [
          '-m', `${ram}`,
          '-hda', this.getImagePath(),
          '-accel', 'whpx',
          '-net', 'nic',
          '-net', 'user',
          '-usb',
          '-device', 'usb-tablet',
          '-device', 'virtio-serial-pci',
          '-rtc', 'base=localtime',
          '-display', 'sdl',
          '-smp', 'cores=2',
        ], {
          stdio: 'inherit',
          shell: false, stdio: ['ignore', 'pipe', 'pipe']
        }) : spawn(`${this.getQemuPath()}\\qemu-system-aarch64.exe`, [
          '-monitor', 'stdio',
          '-M', 'virt,highmem=off',
          '-accel', 'whpx',
          '-cpu', 'host',
          '-m', `${ram}`,
          '-bios', this.getBiosPath(),
          '-device', 'virtio-gpu-pci',
          '-display', 'default,show-cursor=on',
          '-device', 'qemu-xhci',
          '-device', 'usb-kbd',
          '-device', 'usb-tablet',
          '-device', 'intel-hda',
          '-device', 'hda-duplex',
          '-drive', `file=${this.getImagePath()},format=qcow2,if=virtio,cache=writethrough`
        ], { stdio: 'inherit', shell: false, stdio: ['ignore', 'pipe', 'pipe'] });

    qemu.on('error', (e) => {
      console.error(e);
      if (dp) dp(e.message)
    });

    qemu.on('exit', (code) => {
      console.log(`QEMU exited with code ${code}`);
      if (dp) dp(`QEMU exited with code ${code}`);
      console.log(qemu.stderr.read())
    });

    if (qemu.stderr && qemu.stdout) {
      qemu.stdout.on('data', (data) => {
        console.log(`QEMU STDOUT: ${data}`);
        if (dp) dp(`QEMU STDOUT: ${data}`);
      });

      qemu.stderr.on('data', (data) => {
        console.error(`QEMU STDERR: ${data}`);
        if (dp) dp(`QEMU STDERR: ${data}`);
      });
    }
    qemu.on('close', (code) => {
      console.log(`QEMU exited with code ${code}`);
      if (dp) dp(`QEMU exited with code ${code}`);
    });
  }

  runVM(dp) {
    switch (this.platform) {
      case "linux":
        return this.runVMLinux(dp);
      case "win32":
        return this.runVMWindows(dp);
      default:
        throw new Error("Unsupported platform");
    }
  }

  constructor() {
    console.log("Detecting platform...\n");
    this.arch = process.arch;
    this.platform = process.platform;
    this.ramsize = Math.round(os.totalmem() / (1024 ** 3));
    this.appdatadir = this.getAppDataDir("Proto");
  }
}

// plat.extractImage("mix.mp3.xz").then(() => {

// }).catch((e) => {
//   console.error(e);
// })

// plat.prepareVM().then(() => {
//   console.log("downloaded..")
// }).catch((e) => {
//   console.error(e);
// })

// plat.runVM();

// plat.enableWhpx().then((b)=>{
//   console.log(b);
// }).catch((e)=>{
//   console.error(e);
// })

// plat.whpxEnabled().then((b)=>{
//   console.log(b);
// }).catch((e)=>{
//   console.error(e);
// })
//

// plat.installQemu().then(()=>{
//   console.log("done.");
// }).catch((e)=>{
//   console.error(e);
// })

// console.log(plat.installQemuLinux());
