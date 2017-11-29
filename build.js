const fs = require('fs');
const AdmZip = require('adm-zip');
const uglify = require('uglify-es');
const cleancss = require('clean-css');
const FirefoxExt = require('sign-addon').default;
const deepCopy = require('./deepCopy.js');
const createCrx = require('./createCrx.js');

const config = require('./config.json');
const CleanCSSOptions = require('./clean_css_config.json');

const rootDir = __dirname.replace(/\\/g, '/') + '/';
const tempDir = rootDir + 'temp/';

const buildExt = process.argv[2];
if (!buildExt || typeof(config[buildExt]) === 'undefined') {
	console.log('Error: ' + buildExt + ' not found!');
	process.exit(0);
}

const extConfig = config[buildExt];
const extIgnores = extConfig.basic.ignores;
const extDir = extConfig.basic.dir;
const outputDir = extConfig.basic.output.replace('{EXT_DIR}', extDir) + '/';
const BaseOutput = tempDir + buildExt + '.zip';
const FirefoxOutput = outputDir + 'firefox/';
const ChromeOutput = outputDir + 'chrome/';
const FirefoxManifest = typeof(extConfig.ext.gecko.manifest) === 'undefined' ? {} : require(extConfig.ext.gecko.manifest.replace('{EXT_DIR}', extDir));
const ChromeManifest = typeof(extConfig.ext.crx.manifest) === 'undefined' ? {} : require(extConfig.ext.crx.manifest.replace('{EXT_DIR}', extDir));

// Check dirs
if (extConfig.basic.version.firefox || extConfig.basic.version.amo) {
	if (!fs.existsSync(FirefoxOutput)) {
		fs.mkdirSync(FirefoxOutput);
	}
}
if (extConfig.basic.version.chrome || extConfig.basic.version.webstore) {
	if (!fs.existsSync(ChromeOutput)) {
		fs.mkdirSync(ChromeOutput);
	}
}

function getFileExt(name) {
	return name.includes('.') ? name.substr(name.lastIndexOf('.') + 1) : '';
}

function readDir(dir) {
	return new Promise((resolve) => {
		let readCount = 0;
		let fileList = [];
		fs.readdir(dir, (err, files) => {
			if (err) {
				console.log(err);
				return;
			}
			files.forEach((filename) => {
				if (extIgnores.includes(filename)) {
					return;
				}
				if (fs.statSync(dir + '/' + filename).isFile()) {
					fileList.push({
						"name": filename,
						"path": dir.substr(extDir.length) + '/' + filename,
						"fullpath": dir + '/' + filename
					});
				} else {
					readCount++;
					readDir(dir + '/' + filename).then((subFileList) => {
						readCount--;
						fileList = fileList.concat(subFileList);
						checkReadFinish();
					});
				}
			});
			checkReadFinish();
		});
		function checkReadFinish() {
			if (isReadFinish()) {
				resolve(fileList);
			}
		}
		function isReadFinish() {
			return readCount === 0;
		}
	});
}

function createZip(output, fileList) {
	return new Promise((resolve) => {
		let f_output = fs.createWriteStream(output);
		let archive = new AdmZip();
		fileList.forEach((f) => {
			if (!f.fullpath.includes('.min.js') && getFileExt(f.fullpath) === 'js') {
				archive.addFile(
					f.path,
					new Buffer(
						uglify.minify(
							fs.readFileSync(f.fullpath, 'utf-8'),
							{ compress: true, mangle: true}
						).code
					)
				);
			} else if (!f.fullpath.includes('.min.css') && getFileExt(f.fullpath) === 'css') {
				archive.addFile(
					f.path,
					new Buffer(
						new cleancss(CleanCSSOptions).minify(fs.readFileSync(f.fullpath, 'utf-8')).styles
					)
				);
			} else {
				archive.addFile(f.path, fs.readFileSync(f.fullpath));
			}
			console.log('Added ' + f.path);
		});
		archive.writeZip(output);
		resolve();
	});
}

readDir(extDir).then((fileList) => {
	console.log('Scanned all files');
	createZip(BaseOutput, fileList).then(() => {
		console.log('Created base zip file');
		// Build chrome extension
		if (extConfig.basic.version.chrome) {
			let zip_out = ChromeOutput + extConfig.ext.filename.replace(/\{VERSION\}/g, extConfig.ext.version) + '.zip';
			let crx_out = ChromeOutput + extConfig.ext.filename.replace(/\{VERSION\}/g, extConfig.ext.version) + '.crx';
			let zip = new AdmZip(BaseOutput);
			let manifest = deepCopy(ChromeManifest);
			manifest.version = extConfig.ext.version;
			manifest.update_url = extConfig.ext.crx.update;
			zip.addFile('manifest.json', new Buffer(JSON.stringify(manifest)));
			zip.writeZip(zip_out);
			createCrx(fs.readFileSync(zip_out), fs.readFileSync(extConfig.ext.crx.key))
			.then((crxBuffer) => {
				fs.writeFile(crx_out, crxBuffer);
				console.log('Build chrome crx version finished');
			});
			console.log('Build chrome version finished');
		}
		// Build chrome webstore format
		if (extConfig.basic.version.webstore) {
			let zip_out = ChromeOutput + extConfig.ext.filename.replace(/\{VERSION\}/g, extConfig.ext.version) + '-webstore.zip';
			let zip = new AdmZip(BaseOutput);
			let manifest = deepCopy(ChromeManifest);
			manifest.version = extConfig.ext.version;
			manifest.update_url = extConfig.ext.crx.update;
			zip.addFile('manifest.json', new Buffer(JSON.stringify(manifest)));
			zip.writeZip(zip_out);
			console.log('Build chrome webstore version finished');
		}
		// Build default firefox extension
		if (extConfig.basic.version.firefox) {
			let xpi_out = FirefoxOutput + extConfig.ext.filename.replace(/\{VERSION\}/g, extConfig.ext.version) + '.xpi';
			let xpi = new AdmZip(BaseOutput);
			let manifest = deepCopy(FirefoxManifest);
			manifest.version = extConfig.ext.version;
			manifest.applications.gecko.id = extConfig.ext.gecko.default;
			manifest.applications.gecko.update_url = extConfig.ext.gecko.update;
			xpi.addFile('manifest.json', new Buffer(JSON.stringify(manifest)));
			xpi.writeZip(xpi_out);
			console.log('Build firefox version finished');
			// Sign
			// FirefoxExt({
			// 	xpiPath: xpi_out,
			// 	version: extConfig.ext.version,
			// 	apiKey: extConfig.amo.user,
			// 	apiSecret: extConfig.amo.secret,
			// 	downloadDir: FirefoxOutput
			// }).then(function(result) {
			// 	if (result.success) {
			// 		console.log("The following signed files were downloaded:");
			// 		console.log(result.downloadedFiles);
			// 		console.log("Your extension ID is:");
			// 		console.log(result.id);
			// 	} else {
			// 		console.error("Your add-on could not be signed!");
			// 		console.error("Check the console for details.");
			// 	}
			// 	console.log(result.success ? "SUCCESS" : "FAIL");
			// })
			// .catch(function(error) {
			// 	console.error("Signing error:", error);
			// });
		}
		// Build amo firefox extension
		if (extConfig.basic.version.amo) {
			let xpi = new AdmZip(BaseOutput);
			let manifest = deepCopy(FirefoxManifest);
			manifest.version = extConfig.ext.version;
			manifest.applications.gecko.id = extConfig.ext.gecko.default;
			xpi.addFile('manifest.json', new Buffer(JSON.stringify(manifest)));
			xpi.writeZip(FirefoxOutput + extConfig.ext.filename.replace(/\{VERSION\}/g, extConfig.ext.version) + '-amo.xpi');
			console.log('Build firefox version finished');
		}
	});
});