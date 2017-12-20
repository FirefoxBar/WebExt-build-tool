const crypto = require('crypto');
const RSA = require("node-rsa");

function generatePublicKey(privateKey) {
	var key = new RSA(privateKey);
	return key.exportKey('pkcs8-public-der');
}
function createCrx(fileContent, privateKey) {
	return new Promise((resolve) => {
		var publicKey = generatePublicKey(privateKey);
		var keyLength = publicKey.length;
		var signature = new Buffer(
			crypto
			.createSign("sha1")
			.update(fileContent)
			.sign(privateKey),
			"binary"
		);
		var sigLength = signature.length;
		var zipLength = fileContent.length;
		var length = 16 + keyLength + sigLength + zipLength;
		var crx = new Buffer(length);
		crx.write("Cr24" + new Array(13).join("\x00"), "binary");
		crx[4] = 2;
		crx.writeUInt32LE(keyLength, 8);
		crx.writeUInt32LE(sigLength, 12);
		publicKey.copy(crx, 16);
		signature.copy(crx, 16 + keyLength);
		fileContent.copy(crx, 16 + keyLength + sigLength);
		resolve(crx);
	});
}
module.exports = createCrx;