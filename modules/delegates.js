var crypto = require('crypto'),
	bignum = require('bignum'),
	ed = require('ed25519'),
	params = require('../helpers/params.js'),
	shuffle = require('knuth-shuffle').knuthShuffle,
	Router = require('../helpers/router.js'),
	arrayHelper = require('../helpers/array.js'),
	slots = require('../helpers/slots.js'),
	schedule = require('node-schedule'),
	util = require('util'),
	genesisblock = require("../helpers/genesisblock.js");

require('array.prototype.find'); //old node fix

//private fields
var modules, library, self;


var keypairs, myDelegate, address, account;
var delegates = {};
var activeDelegates = [];
var loaded = false;
var unconfirmedDelegates = [];
var tasks = [];

//constructor
function Delegates(cb, scope) {
	library = scope;
	self = this;
	keypairs = [];

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

	router.get('/forging/status', function (req, res) {
		var publicKey = req.query.publicKey;

		if (!publicKey) {
			return res.json({success: false, error: "Provide public key of account"});
		}

		var enabled = false;
		for (var i = 0; i < keypairs.length; i++) {
			if (keypairs[i].publicKey.toString('hex') == req.query.publicKey) {
				enabled = true;
				break;
			}
		}

		return res.json({success: true, enabled: enabled});
	});

	router.post('/forging/enable', function (req, res) {
		var secret = req.query.secret;

		if (!secret) {
			return res.json({success: false, error: "Provide secret key of account"});
		}

		var hash = crypto.createHash('sha256').update(secret, 'utf8').digest();
		var keypair = ed.MakeKeypair(hash);
		var publicKey = keypair.publicKey.toString('hex')

		for (var i = 0; i < keypairs.length; i++) {
			if (keypairs[i].publicKey.toString('hex') == publicKey) {
				return res.json({success: false, error: "Forging on this account already enabled"});
			}
		}

		keypairs.push(keypair);
		return res.json({success: true});
	});

	router.get('/forging/disable', function (req, res) {
		var secret = req.queyr.secret;

		if (!secret) {
			return res.json({success: false, error: "Provide secret key of account"});
		}

		var hash = crypto.createHash('sha256').update(secret, 'utf8').digest();
		var keypair = ed.MakeKeypair(hash);
		var publicKey = keypair.publicKey.toString('hex')

		for (var i = 0; i < keypairs.length; i++) {
			if (keypairs[i].publicKey.toString('hex') == publicKey) {
				keypairs.splice(i, 1);
				return res.json({success: true});
			}
		}

		return res.json({success: false, error: "Forger with this public key not found"});
	});

	router.put('/', function (req, res) {
		var secret = params.string(req.body.secret),
			publicKey = params.hex(req.body.publicKey, true),
			secondSecret = params.string(req.body.secondSecret, true),
			username = params.string(req.body.username);

		var hash = crypto.createHash('sha256').update(secret, 'utf8').digest();
		var keypair = ed.MakeKeypair(hash);

		if (publicKey) {
			if (keypair.publicKey.toString('hex') != publicKey) {
				return res.json({success: false, error: "Please, provide valid secret key of your account"});
			}
		}

		var account = modules.accounts.getAccountByPublicKey(keypair.publicKey.toString('hex'));

		if (!account) {
			return res.json({success: false, error: "Account doesn't has balance"});
		}

		if (!account.publicKey) {
			return res.json({success: false, error: "Open account to make transaction"});
		}

		var transaction = {
			type: 2,
			amount: 0,
			recipientId: null,
			senderPublicKey: account.publicKey,
			timestamp: slots.getTime(),
			asset: {
				delegate: {
					username: username
				}
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

function getKeysSortByVote(delegates) {
	var delegatesArray = arrayHelper.hash2array(delegates);
	delegatesArray = delegatesArray.sort(function compare(a, b) {
		return (b.vote || 0) - (a.vote || 0);
	})
	var justKeys = delegatesArray.map(function (v) {
		return v.publicKey;
	});
	return justKeys;
}

function getBlockTime(slot, height, delegateCount) {
	activeDelegates = self.generateDelegateList(getKeysSortByVote(delegates), height, delegateCount);

	library.logger.log('getBlockTime ' + slot + ' ' + height + ' ' + delegateCount, activeDelegates.map(function (id) {
		return id.substring(0, 4);
	}))

	var currentSlot = slot;
	var lastSlot = slots.getLastSlot(currentSlot);

	for (; currentSlot < lastSlot; currentSlot += 1) {
		var delegate_pos = currentSlot % delegateCount;

		var delegate_id = activeDelegates[delegate_pos];
		if (delegate_id && myDelegate.publicKey == delegate_id) {
			return slots.getSlotTime(currentSlot);
		}
	}
	return null;
}

function loop(cb) {
	setImmediate(cb);

	if (!myDelegate || !account) {
		library.logger.log('loop', 'exit: no delegate');
		return;
	}

	if (!loaded || modules.loader.syncing()) {
		library.logger.log('loop', 'exit: syncing');
		return;
	}

	var currentSlot = slots.getSlotNumber();
	var lastBlock = modules.blocks.getLastBlock();

	if (currentSlot == slots.getSlotNumber(lastBlock.timestamp)) {
		library.logger.log('loop', 'exit: lastBlock is in the same slot');
		return;
	}

	var delegateCount = slots.delegates;

	var currentBlockTime = getBlockTime(currentSlot, lastBlock.height + 1, delegateCount);

	if (currentBlockTime === null) {
		library.logger.log('loop', 'skip slot');
		return;
	}

	library.sequence.add(function (cb) {
		// how to detect keypair
		if (slots.getSlotNumber(currentBlockTime) == slots.getSlotNumber()) {
			modules.blocks.generateBlock(keypair, currentBlockTime, delegateCount, function (err) {
				library.logger.log('new block ' + modules.blocks.getLastBlock().id + ' ' + modules.blocks.getLastBlock().height + ' ' + slots.getSlotNumber(currentBlockTime) + ' ' + lastBlock.height, activeDelegates.map(function (id) {
					return id.substring(0, 4);
				}))
				cb(err);
			});
		} else {
			library.logger.log('loop', 'exit: another delegate slot');
			setImmediate(cb);
		}
	}, function (err) {
		if (err) {
			library.logger.error("Problem in block generation", err);
		}
	});
}

function calcRound(height, delegateCount) {
	return Math.floor(height / delegateCount) + (height % delegateCount > 0 ? 1 : 0);
}

function loadMyDelegates() {
	var secret = library.config.forging.secret

	if (secret) {
		keypair = ed.MakeKeypair(crypto.createHash('sha256').update(secret, 'utf8').digest());
		address = modules.accounts.getAddressByPublicKey(keypair.publicKey.toString('hex'));
		account = modules.accounts.getAccount(address);
		myDelegate = self.getDelegate(keypair.publicKey.toString('hex'));

		library.logger.info("Forging enabled on account: " + address);
	}
}

//public methods
Delegates.prototype.generateDelegateList = function (roundDelegateList, height, delegateCount) {
	var seedSource = calcRound(height, delegateCount).toString();

	var currentSeed = crypto.createHash('sha256').update(seedSource, 'utf8').digest();
	for (var i = 0, delCount = roundDelegateList.length; i < delCount; i++) {
		for (var x = 0; x < 4 && i < delCount; i++, x++) {
			var newIndex = currentSeed[x] % delCount;
			var b = roundDelegateList[newIndex];
			roundDelegateList[newIndex] = roundDelegateList[i];
			roundDelegateList[i] = b;
		}
		currentSeed = crypto.createHash('sha256').update(currentSeed).digest();
	}

	return roundDelegateList;
}

Delegates.prototype.checkDelegates = function (votes) {
	if (votes === null) {
		return true;
	}

	if (util.isArray(votes)) {
		votes.forEach(function (publicKey) {
			if (!delegates[publicKey]) {
				return false;
			}
		});

		return true;
	} else {
		return false;
	}
}

Delegates.prototype.addUnconfirmedDelegate = function (publicKey) {
	unconfirmedDelegates[publicKey];
}

Delegates.prototype.getUnconfirmedDelegate = function (publicKey) {
	return unconfirmedDelegates[publicKey];
}

Delegates.prototype.removeUnconfirmedDelegate = function (publicKey) {
	delete unconfirmedDelegates[publicKey];
}

Delegates.prototype.getDelegate = function (publicKey) {
	return delegates[publicKey];
}

Delegates.prototype.getDelegateByName = function (userName) {
	var delegatesArray = arrayHelper.hash2array(delegates);
	return delegatesArray.find(function (item) {
		return item.username === userName;
	})
}

Delegates.prototype.cache = function (delegate) {
	delegates[delegate.publicKey] = delegate;
	slots.delegates = Math.min(101, Object.keys(delegates).length)
}

Delegates.prototype.uncache = function (delegate) {
	delete delegates[delegate.publicKey];
	slots.delegates = Math.min(101, Object.keys(delegates).length)
}

Delegates.prototype.validateBlockSlot = function (block) {
	if (!block.delegates) return false;

	var activeDelegates = self.generateDelegateList(getKeysSortByVote(delegates), block.height, block.delegates);

	var currentSlot = slots.getSlotNumber(block.timestamp);
	var delegate_id = activeDelegates[currentSlot % block.delegates];
	if (delegate_id && block.generatorPublicKey == delegate_id) {
		//library.logger.log('validation pass', activeDelegates.map(function (id) {
		//	return id.substring(0, 4);
		//}))
		return true;
	}

	library.logger.log('validation fail', activeDelegates.map(function (id) {
		return id.substring(0, 4);
	}))
	return false;
}

Delegates.prototype.tick = function (block) {
	var lastRound = calcRound(block.height, block.delegates);
	var nextRound = calcRound(block.height + 1, slots.delegates);

	if (nextRound !== lastRound) {
		library.bus.message('finishRound', lastRound);
	}
}

//events
Delegates.prototype.onBind = function (scope) {
	modules = scope;
}

Delegates.prototype.onBlockchainReady = function () {
	loaded = true;

	loadMyDelegates(); //temp

	process.nextTick(function nextLoop() {
		loop(function (err) {
			err && library.logger.error('delegate loop', err);

			var nextSlot = slots.getNextSlot();

			var scheduledTime = slots.getSlotTime(nextSlot);
			scheduledTime = scheduledTime <= slots.getTime() ? scheduledTime + 1 : scheduledTime;
			schedule.scheduleJob(new Date(slots.getRealTime(scheduledTime) + 1000), nextLoop);
		})
	});
}

Delegates.prototype.onNewBlock = function (block, broadcast) {
	tasks.push(function () {
		if (keypair) {
			myDelegate = self.getDelegate(keypair.publicKey.toString('hex'));
		}
	});

	self.tick(block);
}

Delegates.prototype.onChangeBalance = function (account, amount) {
	tasks.push(function () {
		amount = amount / 1000000000;
		if (util.isArray(account.delegates)) {
			account.delegates.forEach(function (publicKey) {
				delegates[publicKey].vote = (delegates[publicKey].vote || 0) + amount;
			});
		}
	});
}

Delegates.prototype.onChangeDelegates = function (account, newDelegates) {
	tasks.push(function () {
		var balance = account.balance / 1000000000;
		if (util.isArray(account.delegates)) {
			account.delegates.forEach(function (publicKey) {
				delegates[publicKey].vote = (delegates[publicKey].vote || 0) - balance;
			});
		}

		if (util.isArray(newDelegates)) {
			newDelegates.forEach(function (publicKey) {
				delegates[publicKey].vote = (delegates[publicKey].vote || 0) + balance;
			});
		}
	});
}

Delegates.prototype.onFinishRound = function (round) {
	while (tasks.length) {
		var task = tasks.shift();
		task();
	}
}

//export
module.exports = Delegates;