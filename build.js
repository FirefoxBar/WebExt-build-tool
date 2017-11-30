const fs = require('fs');
const JSZip = require('jszip');
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
					let prefix = dir.substr(extDir.length + 1) + '/';
					fileList.push({
						"name": filename,
						"path": (prefix === '/' ? '' : prefix) + filename,
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
		let archive = new JSZip();
		fileList.forEach((f) => {
			if (!f.fullpath.includes('.min.js') && getFileExt(f.fullpath) === 'js') {
				archive.file(
					f.path,
					new Buffer(
						uglify.minify(
							fs.readFileSync(f.fullpath, 'utf-8'),
							{ compress: true, mangle: true}
						).code
					)
				);
			} else if (!f.fullpath.includes('.min.css') && getFileExt(f.fullpath) === 'css') {
				archive.file(
					f.path,
					new Buffer(
						new cleancss(CleanCSSOptions).minify(fs.readFileSync(f.fullpath, 'utf-8')).styles
					)
				);
			} else {
				archive.file(f.path, fs.readFileSync(f.fullpath));
			}
			console.log('Added ' + f.path);
		});
		archive
		.generateAsync({
			type: "nodebuffer",
			compression: "DEFLATE",
			compressionOptions: {
				level: 9
			}
		})
		.then(r => {
			fs.writeFileSync(output, r)
		})
		.then(resolve);
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
			let zip = new JSZip();
			let manifest = deepCopy(ChromeManifest);
			manifest.version = extConfig.ext.version;
			manifest.update_url = extConfig.ext.crx.update;
			zip.loadAsync(fs.readFileSync(BaseOutput)).then(() => {
				zip.file('manifest.json', new Buffer(JSON.stringify(manifest)));
			})
			.then(() => {
				return zip.generateAsync({
					type: "nodebuffer",
					compression: "DEFLATE",
					compressionOptions: {
						level: 9
					}
				})
			})
			.then((r) => {
				fs.writeFileSync(zip_out, r)
			})
			.then(() => {
				return createCrx(fs.readFileSync(zip_out), fs.readFileSync(extConfig.ext.crx.key));
			})
			.then((crxBuffer) => {
				fs.writeFileSync(crx_out, crxBuffer);
				console.log('Build chrome crx version finished');
			});
		}
		// Build chrome webstore format
		if (extConfig.basic.version.webstore) {
			let zip_out = ChromeOutput + extConfig.ext.filename.replace(/\{VERSION\}/g, extConfig.ext.version) + '-webstore.zip';
			let zip = new JSZip();
			let manifest = deepCopy(ChromeManifest);
			manifest.version = extConfig.ext.version;
			zip.loadAsync(fs.readFileSync(BaseOutput)).then(() => {
				zip.file('manifest.json', new Buffer(JSON.stringify(manifest)));
			})
			.then(() => {
				return zip.generateAsync({
					type: "nodebuffer",
					compression: "DEFLATE",
					compressionOptions: {
						level: 9
					}
				})
			})
			.then((r) => {
				fs.writeFileSync(zip_out, r);
				console.log('Build chrome webstore version finished');
			});
		}
		// Build default firefox extension
		if (extConfig.basic.version.firefox) {
			let zip_out = FirefoxOutput + extConfig.ext.filename.replace(/\{VERSION\}/g, extConfig.ext.version) + '.zip';
			let xpi_out = FirefoxOutput + extConfig.ext.filename.replace(/\{VERSION\}/g, extConfig.ext.version) + '.xpi';
			let app_id = extConfig.ext.gecko.default;
			let zip = new JSZip();
			let manifest = deepCopy(FirefoxManifest);
			manifest.version = extConfig.ext.version;
			manifest.applications.gecko.id = app_id;
			manifest.applications.gecko.update_url = extConfig.ext.gecko.update;
			zip.loadAsync(fs.readFileSync(BaseOutput)).then(() => {
				zip.file('manifest.json', new Buffer(JSON.stringify(manifest)));
			})
			.then(() => {
				return zip.generateAsync({
					type: "nodebuffer",
					compression: "DEFLATE",
					compressionOptions: {
						level: 9
					}
				})
			})
			.then((r) => {
				fs.writeFileSync(zip_out, r);
			})
			.then(() => {
				// sign
				FirefoxExt({
					xpiPath: zip_out,
					version: extConfig.ext.version,
					apiKey: extConfig.amo.user,
					apiSecret: extConfig.amo.secret,
					id: app_id,
					downloadDir: FirefoxOutput
				})
				.then(function(result) {
					if (result.success) {
						console.log("Downloaded signed addon");
						// Move download file to output dir
						if (result.downloadedFiles[0] !== xpi_out) {
							fs.renameSync(result.downloadedFiles[0], xpi_out);
						}
						// If require update.json, generate it
						if (extConfig.ext.gecko.update_local) {
							const update_file_path = extConfig.ext.gecko.update_local.replace('{EXT_DIR}', extDir);
							let update_file_json = require(update_file_path);
							console.log(update_file_json.addons);
							console.log(app_id);
							console.log(update_file_json.addons[app_id]);
							if (update_file_json.addons[app_id].updates.length > 2) {
								update_file_json.addons[app_id].updates.splice(2, update_file_json.addons[app_id].updates.length - 2);
							}
							update_file_json.addons[app_id].updates.push({
								"version": extConfig.ext.version,
								"update_link": extConfig.ext.gecko.download_url.replace(/\{VERSION\}/g, extConfig.ext.version),
								"update_hash": result.raw_data.files[0].hash
							});
							fs.writeFileSync(update_file_path, new Buffer(JSON.stringify(update_file_json)));
							console.log('Updated update.json');
						}
					}
					console.log('SIGN ' + (result.success ? "SUCCESS" : "FAIL"));
				})
				.catch(function(error) {
					console.error("Signing error:", error);
				});
			});
		}
		// Build amo firefox extension
		if (extConfig.basic.version.amo) {
			let zip_out = FirefoxOutput + extConfig.ext.filename.replace(/\{VERSION\}/g, extConfig.ext.version) + '-amo.zip';
			let app_id = extConfig.ext.gecko.amo;
			let zip = new JSZip();
			let manifest = deepCopy(FirefoxManifest);
			manifest.version = extConfig.ext.version;
			manifest.applications.gecko.id = app_id;
			zip.loadAsync(fs.readFileSync(BaseOutput)).then(() => {
				zip.file('manifest.json', new Buffer(JSON.stringify(manifest)));
			})
			.then(() => {
				return zip.generateAsync({
					type: "nodebuffer",
					compression: "DEFLATE",
					compressionOptions: {
						level: 9
					}
				})
			})
			.then((r) => {
				fs.writeFileSync(zip_out, r);
			})
			.then(() => {
				// sign
				FirefoxExt({
					xpiPath: zip_out,
					version: extConfig.ext.version,
					apiKey: extConfig.amo.user,
					apiSecret: extConfig.amo.secret,
					id: app_id
				})
				.then(function(result) {
					console.log('SIGN ' + (result.success ? "SUCCESS" : "FAIL"));
				})
				.catch(function(error) {
					console.error("Signing error:", error);
				});
			});
		}
	});
});