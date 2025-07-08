
const https = require('https');
const fs = require('fs');
const path = require('path');

const options = {
  key: fs.readFileSync('localhost.key'),
  cert: fs.readFileSync('localhost.crt')
};

const testFilePath = "/home/m/Desktop/VirtualBoxes/ubuntu/ubuntu.qcow2.xz"
//"C:\\Users\\murim\\OneDrive\\Desktop\\qemu.tar.xz"
path.join(__dirname, 'mix.mp3.xz');

https.createServer(options, (req, res) => {
  console.log('Request for', req.url);

    const stat = fs.statSync(testFilePath);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="testfile.bin"'
    });

    const readStream = fs.createReadStream(testFilePath);
    readStream.pipe(res);

}).listen(8443, () => {
  console.log('HTTPS server listening on https://localhost:8443');
});
