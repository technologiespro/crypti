var crypto = require('crypto'),
	bignum = require('bignum'),
	ed = require('ed25519'),
	params = require('../helpers/params.js'),
	timeHelper = require('../helpers/time.js'),
	shuffle = require('knuth-shuffle').knuthShuffle,
	Router = require('../helpers/router.js'),
	arrayHelper = require('../helpers/array.js'),
	slots = require('../helpers/slots.js'),
	schedule = require('node-schedule');

//private fields
var modules, library, self;

var keypair, myDelegate, address, account;
var delegates = {};
var unconfirmedDelegates = {};
var loaded = false;

//constructor
function Delegates(cb, scope) {
	library = scope;
	self = this;

	attachApi();

	setImmediate(cb, null, self);
}

//private methods
function attachApi() {
	var router = new Router();

	router.use(function (req, res, next) {
		if (modules && loaded) return next();
		res.status(500).send({success: false, error: 'loading'});
	});

	router.put('/', function (req, res) {
		var secret = params.string(req.body.secret),
			publicKey = params.buffer(req.body.publicKey, 'hex'),
			secondSecret = params.string(req.body.secondSecret),
			username = params.string(req.body.username),
			votingType = params.int(req.body.votingType);

		var hash = crypto.createHash('sha256').update(secret, 'utf8').digest();
		var keypair = ed.MakeKeypair(hash);

		if (publicKey.length > 0) {
			if (keypair.publicKey.toString('hex') != publicKey.toString('hex')) {
				return res.json({success: false, error: "Please, provide valid secret key of your account"});
			}
		}

		var account = modules.accounts.getAccountByPublicKey(keypair.publicKey);

		if (!account) {
			return res.json({success: false, error: "Account doesn't has balance"});
		}

		if (!account.publicKey) {
			return res.json({success: false, error: "Open account to make transaction"});
		}

		var votes = self.getVotesByType(votingType);

		if (!votes) {
			return res.json({success: false, error: "Invalid voting type"});
		}

		var transaction = {
			type: 2,
			amount: 0,
			recipientId: null,
			senderPublicKey: account.publicKey,
			timestamp: timeHelper.getNow(),
			asset: {
				delegate: {
					username: username
				},
				votes: votes
			}
		};

		modules.transactions.sign(secret, transaction);

		if (account.secondSignature) {
			if (!secondSecret || secondSecret.length == 0) {
				return res.json({success: false, error: "Provide second secret key"});
			}

			modules.transactions.secondSign(secondSecret, transaction);
		}

		modules.transactions.processUnconfirmedTransaction(transaction, true, function (err) {
			if (err) {
				return res.json({success: false, error: err});
			}

			res.json({success: true, transaction: transaction});
		});
	});

	library.app.use('/api/delegates', router);
	library.app.use(function (err, req, res, next) {
		if (!err) return next();
		library.logger.error('/api/delegates', err)
		res.status(500).send({success: false, error: err});
	});
}

function getShuffleVotes() {
	var delegatesArray = arrayHelper.hash2array(delegates);
	delegatesArray = delegatesArray.sort(function compare(a, b) {
		return (b.vote || 0) - (a.vote || 0);
	})
	var justKeys = delegatesArray.map(function (v) {
		return v.publicKey;
	});
	var final = justKeys.slice(0, 33);
	final.forEach(function (publicKey) {
		if (delegates[publicKey]) {
			delegates[publicKey].vote = 0;
		}
	})
	return shuffle(final);
}

function forAllVote() {
	return [];
}

function getNextBlockTime() {
	var activeDelegates = modules.delegates.getActiveDelegates();

	var nextSlot = slots.getNextSlot();
	var lastSlot = slots.getLastSlot(nextSlot);

	for (; nextSlot < lastSlot; nextSlot += 1) {
		var delegate_pos = nextSlot % slots.delegates;
		var delegate_id = activeDelegates[delegate_pos];

		if (myDelegate.publicKey == delegate_id) {
			return slots.getSlotTime(nextSlot);
		}
	}
	return null;
}

function loop(cb) {
	if (!myDelegate || !account) {
		return setImmediate(cb);
	}

	if (!loaded || modules.loader.syncing()) {
		return setImmediate(cb);
	}

	if (account.balance < 1000 * constants.fixedPoint) {
		return setImmediate(cb);
	}

	var nextBlockTime = getNextBlockTime();
	if (nextBlockTime && nextBlockTime <= slots.getTime()) {
		library.sequence.add(function (cb) {
			if (slots.getSlotNumber(nextBlockTime) == slots.getSlotNumber()) {
				modules.blocks.generateBlockv2(keypair, cb);
			} else {
				setImmediate(cb);
			}
		}, function (err) {
			if (err) {
				library.logger.error("Problem in block generation", err);
			}
			setImmediate(cb, err);
		});
	}
}

function addUnconfirmedDelegate(delegate) {
	if (self.getUnconfirmedDelegate(delegate.publicKey)) {
		return false
	}

	unconfirmedDelegates[delegate.publicKey] = delegate;
	return true;
}

function loadMyDelegates() {
	var secret = library.config.forging.secret

	if (secret) {
		keypair = ed.MakeKeypair(crypto.createHash('sha256').update(secret, 'utf').digest());
		myDelegate = modules.delegates.getDelegate(keypair.publicKey);
		address = modules.accounts.getAddressByPublicKey(keypair.publicKey);
		account = modules.accounts.getAccount(address);
	}
}

//public methods
Delegates.prototype.getVotesByType = function (votingType) {
	if (votingType == 1) {
		return forAllVote();
	} else if (votingType == 2) {
		return getShuffleVotes();
	} else {
		return null;
	}
}

Delegates.prototype.checkVotes = function (votes) {
	votes = votes || []; //temp
	if (votes.length == 0) {
		return true;
	} else {
		votes.forEach(function (publicKey) {
			if (!delegates[publicKey]) {
				return false;
			}
		});

		return true;
	}
}

Delegates.prototype.voting = function (publicKeys) {
	if (publicKeys.length == 0) {
		for (var publicKey in delegates) {
			delegates[publicKey].vote = (delegates[publicKey].vote || 0) + 1;
		}
	} else {
		publicKeys.forEach(function (publicKey) {
			delegates[publicKey].vote = (delegates[publicKey].vote || 0) + 1;
		});
	}
}

Delegates.prototype.getDelegate = function (publicKey) {
	return delegates[publicKey];
}

Delegates.prototype.getActiveDelegates = function () {
	return arrayHelper.hash2array(delegates);
}

Delegates.prototype.getUnconfirmedDelegate = function (publicKey) {
	return unconfirmedDelegates[publicKey];
}

Delegates.prototype.removeUnconfirmedDelegate = function (publicKey) {
	if (unconfirmedDelegates[publicKey]) {
		delete unconfirmedDelegates[publicKey];
	}
}

Delegates.prototype.cache = function (delegate) {
	delegates[delegate.publicKey] = delegate;
}

//events
Delegates.prototype.onBind = function (scope) {
	modules = scope;

	loadMyDelegates(); //temp

	library.logger.info("Forging enabled on account: " + address);

	process.nextTick(function nextLoop() {
		loop(function (err) {
			err && library.logger.error('delegate loop', err);
			var nextSlot = slots.getNextSlot();
			var scheduledTime = slots.getSlotTime(nextSlot);
			scheduledTime = scheduledTime <= slots.getTime() ? scheduledTime + 1 : scheduledTime;
			schedule.scheduleJob(scheduledTime * 1000, nextLoop);
		})
	});
}

Delegates.prototype.onBlockchainReady = function () {
	loaded = true;
}

Delegates.prototype.onUnconfirmedTransaction = function (transaction) {
	if (transaction.asset.delegate) {
		var delegate = {
			publicKey: transaction.senderPublicKey,
			username: transaction.asset.delegate.username,
			transactionId: transaction.id
		};
		addUnconfirmedDelegate(delegate);
	}
}

Delegates.prototype.onNewBlock = function (block) {
	for (var i = 0; i < block.transactions.length; i++) {
		var transaction = block.transactions[i];
		if (transaction.type == 4) {
			self.cache({
				publicKey: transaction.senderPublicKey,
				username: transaction.asset.delegate.username,
				transactionId: transaction.id
			});
		}
	}
}

//export
module.exports = Delegates;