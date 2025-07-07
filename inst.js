const os = require("os");
const sudo = require("@vscode/sudo-prompt");
const fs = require("fs");
const lzma = require("lzma-native");
const https = require("https");
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const { stderr, stdout } = require("process");
const path = require('path');

const vmimgpath =
  // "/home/m/Desktop/VirtualBoxes/ubuntu/ubuntu.qcow2"
  "VMIMAGE.qcow2";
const biospath = "bios.efi";

const vmxzpath = "VMIMAGE.qcow2.xz";

const biosurl = ""
const arm64imgurl = "";

const x86_64imgurl = "https://localhost:8443/testfile";

const authorize = false;
const RAMRATIO = 3;

function fileExists(imagePath) {
  try {
    return fs.existsSync(imagePath) && fs.statSync(imagePath).isFile();
  } catch (err) {
    return false;
  }
}

class Platform {
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

  extractImage(xzpath, outpath) {
    return new Promise((resolve, reject) => {
      fs.writeFileSync(outpath, "");
      const input = fs.createReadStream(xzpath);
      const output = fs.createWriteStream(outpath);
      const totalsize = fs.statSync(xzpath).size;
      let processedbytes = 0;
      input.on('data', (chunk) => {
        processedbytes += chunk.length;
        const percent = ((processedbytes / totalsize) * 100).toFixed(2);
        process.stdout.write(`\rDecompressing... ${percent}%`);
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

  switchArch() {
    switch (this.arch) {
      case "arm64":
      case "x64":
        return true;
    }
    return false;
  }

  downloadStuff(url, outputpath) {
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
            process.stdout.write(`\rDownloading: ${percent}%`);
          } else {
            process.stdout.write(`\rDownloading: ${downloadedSize} bytes`);
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

  getxzPath() {
    return path.join(this.appdatadir, vmxzpath);
  }

  getImagePath() {
    return path.join(this.appdatadir, vmimgpath);
  }

  getBiosPath() {
    return path.join(this.appdatadir, biospath);
  }

  async downloadImage(outputpath) {
    if (!this.switchArch()) throw new Error("Unsupported architecture");
    const url = this.arch === "arm64" ? arm64imgurl : x86_64imgurl;
    await this.downloadStuff(url, outputpath);
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
        return `apt install -y ${qemupkg}`;
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

  installQemuLinux() {
    const pkgs = this.getLinuxQemuPkg();
    if (pkgs === "") return; //already installed
    const pkgcommand = this.getLinuxPMCommand(this.getLinuxPM(), pkgs);
    sudo.exec(pkgcommand, {}, (err, stderr) => {
      if (err) {
        throw err;
      }
      console.log(stderr);
    });
    console.log(pkgcommand);
  }

  installQemu() {
    switch (this.platform) {
      case "linux":
        return this.installQemuLinux();
      default:
        throw new Error("Unsupported platform");
    }
  }

  async prepareVM() {
    if (!fileExists(this.getImagePath())) {
      await this.downloadImage(this.getxzPath());
      if (this.arch == "arm64") {
        this.downloadStuff(biosurl, this.getBiosPath());
      }
      await this.extractImage(this.getxzPath(), this.getImagePath());
      this.installQemu();
    }
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

    qemu.stdout.on('data', (data) => {
      console.log(`QEMU STDOUT: ${data}`);
    });

    qemu.stderr.on('data', (data) => {
      console.error(`QEMU STDERR: ${data}`);
    });

    qemu.on('close', (code) => {
      console.log(`QEMU exited with code ${code}`);
    });
  }

  runVM() {
    switch (this.platform) {
      case "linux":
        return this.runVMLinux();
      default:
        throw new Error("Unsupported platform");
    }
  }

  constructor() {
    this.arch = process.arch;
    this.platform = process.platform;
    this.ramsize = Math.round(os.totalmem() / (1024 ** 3));
    this.appdatadir = this.getAppDataDir("Proto");
  }
}

const plat = new Platform();
// plat.extractImage("mix.mp3.xz").then(() => {

// }).catch((e) => {
//   console.error(e);
// })

plat.prepareVM().then(() => {
  console.log("downloaded..")
}).catch((e) => {
  console.error(e);
})

// plat.runVM()

// console.log(plat.installQemuLinux());
