# WebExt build tool

A simple tool to build a WebExt. This tool can:

* Compress css and js files
* Build four version, include: Firefox xpi, Mozilla AMO, Chrome crx, Chrome Webstore

## How to use

* Install nodejs and npm

* Run `npm install`

* Rename `config.sample.json` to `config.json`, and fill some informations in it

* If you require build Firefox xpi version, you should modify `node_modules/sign-addon/dist/sign-addon.js`, about line 422:

```js
// Old code:
return _extends({
	id: data.guid
}, result);
// Modify to:
return _extends({
	id: data.guid,
	raw_data: data
}, result);
```

* Run `node build.js ext_name` (`ext_name` is you set in `config.json`)