var ed  = require('ed25519'),
    bignum = require('bignum'),
    Account = require("../account").account,
    crypto = require("crypto"),
    company = require("../company").company,
    transaction = require("../transactions").transaction,
    utils = require("../utils.js"),
    request = require('request');

module.exports = function (app) {
    app.post("/api/getToken", app.basicAuth, function (req, res) {
        try {
            var secret = req.body.secret || "",
                accountAddress = req.body.accountAddress || "",
                companyName = req.body.companyName || "",
                description = req.body.description || "",
                domain = req.body.domain || "",
                email = req.body.email || "",
                secondPhrase = req.body.secondPhrase || null;

            if (secret.length == 0) {
                return res.json({ success: false, status: "PROVIDE_SECRET_PHRASE", error: "Provide secret phrase" });
            }

            var signature = app.signatureprocessor.getSignatureByAddress(accountAddress);

            if (signature) {
                if (!secondPhrase) {
                    return res.json({ success: false, error: "Provide second secret phrase", statusCode: "PROVIDE_SECOND_PASSPHRASE" });
                }

                var secondHash = crypto.createHash('sha256').update(secondPhrase, 'utf8').digest();
                var secondKeypair = ed.MakeKeypair(secondHash);

                if (signature.publicKey.toString('hex') != secondKeypair.publicKey.toString('hex')) {
                    return res.json({ success: false, error: "Second passphrase not valid", statusCode: "INVALID_SECOND_PASSPHRASE" });
                }
            }

            var hash = crypto.createHash('sha256').update(new Buffer(secret, 'utf8')).digest();
            var keypair = ed.MakeKeypair(hash);

            if (accountAddress.length > 0) {
                var address = app.accountprocessor.getAddressByPublicKey(keypair.publicKey);

                if (address != accountAddress) {
                    return res.json({ success: false, status: "INVALID_PASSPHRASE", error: "Invalid passphrase" });
                }
            }

            var timestamp = utils.getEpochTime(new Date().getTime());
            var c = new company(companyName, description, domain, email, timestamp, keypair.publicKey);

            if (!app.companyprocessor.checkCompanyData(c)) {
                return res.json({ success: false, status: "INVALID_DATA_OF_COMPANY", error: "Invalid data to create company, see logs" });
            }

            c.sign(secret);

            if (!c.verify()) {
                return res.json({ success: false, status: "CANT_VERIFY_SIGNATURE", error: "Can't verify singature" });
            }

            return res.json({ success: true, status: "OK", token: c.signature.toString('base64'), timestamp: timestamp });
        } catch (e) {
            app.logger.error("Exception, notify developers: ");
            app.logger.error(e);
            return res.json({ success : false, error : "Exception", status : "EXCEPTION" });
        }
    });

    app.post("/api/createCompany", app.basicAuth, function (req, res) {
        try {
            var secret = req.body.secret || "",
                accountAddress = req.body.accountAddress || "",
                companyName = req.body.companyName || "",
                description = req.body.description || "",
                domain = req.body.domain || "",
                email = req.body.email || "",
                timestamp = req.body.timestamp || null,
                secondPhrase = req.body.secondPhrase || null;

            if (secret.length == 0) {
                return res.json({ success: false, status: "PROVIDE_SECRET_PHRASE", error: "Provide secret phrase" });
            }

            if (!timestamp) {
                return res.json({ success: false, status: "PROVIDE_TIMESTAMP", error: "Provide timestamp" });
            }

            timestamp = parseInt(timestamp);

            if (isNaN(timestamp) || timestamp <= 0) {
                return res.json({ success: false, status: "PROVIDE_VALID_TIMESTAMP", error: "Provide valid timestampo" });
            }

            var hash = crypto.createHash('sha256').update(new Buffer(secret, 'utf8')).digest();
            var keypair = ed.MakeKeypair(hash);

            if (accountAddress.length > 0) {
                var address = app.accountprocessor.getAddressByPublicKey(keypair.publicKey);

                if (address != accountAddress) {
                    return res.json({ success: false, status: "INVALID_PASSPHRASE", error: "Invalid passphrase" });
                }
            }

            var c = new company(companyName, description, domain, email, timestamp, keypair.publicKey);

            if (!app.companyprocessor.checkCompanyData(c)) {
                return res.json({ success: false, status: "INVALID_DATA_OF_COMPANY", error: "Invalid data to create company, see logs" });
            }

            c.sign(secret);

            if (!c.verify()) {
                return res.json({ success: false, status: "CANT_VERIFY_SIGNATURE", error: "Can't verify singature" });
            }

            // check file
            var getOptions = {
                hostname: c.domain,
                port: 80,
                path: '/cryptixcr.txt'
            };

            var timeout = null;

            request({
                url: "http://" + c.domain + "/cryptixcr.txt",
                headers: {
                    'User-Agent': 'Crypti Agent'
                },
                timeout : 3000
            }, function (err, resp, body) {
                if (err) {
                    return res.json({ status: "CANT_GET_CRYPTIXCR_FILE", success: false, error: "Check you website address, can't get http response" });
                }

                var data = body.replace(/^\s+|\s+$/g, "");
                if (data != c.signature.toString('base64')) {
                    return res.json({ status: "INVALID_KEY_IN_CRYPTIXCR_FILE", success: false, error: "Please check your cryptixcr.txt file. The token appears to be invalid." });
                } else {
                    var sender = app.accountprocessor.getAccountByPublicKey(keypair.publicKey);

                    if (!sender) {
                        return res.json({ success: false, error: "Sender not found", status: "SENDER_NOT_FOUND"});
                    }

                    var t = new transaction(3, null, utils.getEpochTime(new Date().getTime()), keypair.publicKey, null, 0, null);
                    t.asset = c;
                    t.sign(secret);

                    var signature = app.signatureprocessor.getSignatureByAddress(sender.address);

                    if (signature) {
                        if (!secondPhrase) {
                            return res.json({ success: false, error: "Provide second secret phrase", statusCode: "PROVIDE_SECOND_PASSPHRASE" });
                        }

                        var secondHash = crypto.createHash('sha256').update(secondPhrase, 'utf8').digest();
                        var secondKeypair = ed.MakeKeypair(secondHash);

                        if (signature.publicKey.toString('hex') != secondKeypair.publicKey.toString('hex')) {
                            return res.json({ success: false, error: "Second signature not valid", statusCode: "INVALID_SECOND_PASSPHRASE" });
                        }

                        t.signSignatureGeneration(secondPhrase);
                    }

                    var result = app.transactionprocessor.processTransaction(t, true);
                    if (result) {
                        return res.json({ success: true, transactionId: t.getId(), status: "OK" });
                    } else {
                        return res.json({ success: false, error: "This domain for company already added", status: "DOMAIN_ALREADY_ADDED" });
                    }
                }
            });
        } catch (e) {
            app.logger.error("Exception, notify developers: ");
            app.logger.error(e);
            return res.json({ success : false, error : "Exception", status : "EXCEPTION" });
        }
    });
}