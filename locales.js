const fs = require('fs');
const request = require('request');
const deepCopy = require('./deepCopy.js');
const config = require('./config.json');

const buildExt = process.argv[2];
if (!buildExt || typeof(config[buildExt]) === 'undefined') {
	console.log('Error: ' + buildExt + ' not found!');
	process.exit(0);
}

const extConfig = config[buildExt];
const extIgnores = extConfig.basic.ignores;
const extDir = extConfig.basic.dir;

const buildDir = __dirname.replace(/\\/g, '/');
const rootDir = buildDir.substr(0, buildDir.lastIndexOf('/'));
const outputDir = extConfig.locales.dir.replace('{EXT_DIR}', extDir);

const placeholder = require(extConfig.locales.placeholder.replace('{EXT_DIR}', extDir));

const default_language_name = extConfig.locales.default;
const languages = extConfig.locales.languages;

function requestTransifex(api) {
	return new Promise((resolve) => {
		request.get({
			"url": "https://www.transifex.com/api/2/" + api,
			"auth": {
				"user": extConfig.transifex.user,
				"pass": extConfig.transifex.token
			}
		}, (err, data, body) => {
			resolve(JSON.parse(body));
		});
	});
}
function ksort(obj) {
	let objKeys = Object.keys(obj);
	objKeys.sort((k1, k2) => {
		let i = 0;
		while (i < (k1.length - 1) && i < (k2.length - 1) && k1[i] === k2[i]) {
			i++;
		}
		if (k1[i] === k2[i]) {
			return i < (k1.length - 1) ? 1 : -1;
		} else {
			return k1[i].charCodeAt() > k2[i].charCodeAt() ? 1 : -1;
		}
	});
	let result = {};
	objKeys.forEach(k => result[k] = obj[k]);
	return result;
}
function addPlaceholders(obj) {
	// Add placeholders
	for (const k in placeholder) {
		if (typeof(obj[k]) !== 'undefined') {
			obj[k].placeholders = deepCopy(placeholder[k]);
		} else {
			console.log("%s not exists, please check it", k);
		}
	}
}
function writeOneLanguage(obj, lang, default_language) {
	return new Promise((resolve) => {
		let newObj = deepCopy(obj);
		for (const k in newObj) {
			// remove description
			delete newObj[k]["description"];
		}
		if (typeof(default_language) !== 'undefined') {
			// set english words to it if it is empty
			for (const k in newObj) {
				// remove description
				if (newObj[k].message === '') {
					newObj[k].message = default_language[k].message;
				}
			}
		}
		addPlaceholders(newObj);
		fs.writeFile(outputDir + "/" + lang + "/messages.json", new Buffer(JSON.stringify(newObj)), resolve);
	});
}

// Get default language
requestTransifex('project/' + config.transifex.project + '/resource/messages/translation/' + default_language_name + '/')
.then(r => {
	let default_language = ksort(JSON.parse(r.content));
	if (extConfig.locales.editable) {
		// Write editable locale file
		fs.writeFile(extConfig.locales.editable.replace('{EXT_DIR}', extDir), new Buffer(JSON.stringify(default_language, null, "\t")));
	}
	writeOneLanguage(default_language, default_language_name).then(() => {
		console.log("Write default language ok");
	});
	languages.forEach((lang) => {
		requestTransifex('project/' + config.transifex.project + '/resource/messages/translation/' + lang + '/')
		.then(r => {
			let content = ksort(JSON.parse(r.content));
			if (!fs.existsSync(outputDir + "/" + lang)) {
				fs.mkdirSync(outputDir + "/" + lang);
			}
			writeOneLanguage(content, lang, default_language).then(() => {
				console.log("Write " + lang + " ok");
			});
		})
	});
});