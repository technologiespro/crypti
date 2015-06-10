var node = require('./variables.js'),
	crypto = require('crypto');

describe("Peers", function () {
	it("create transaction. should return ok", function (done) {
		var transaction = node.crypti.transaction.createTransaction("1C", 1, node.peers_config.account);
		node.peer.post('/transactions')
			.set('Accept', 'application/json')
			.send({
				transaction: transaction
			})
			.expect('Content-Type', /json/)
			.expect(200)
			.end(function (err, res) {
				console.log(res.body);
				node.expect(res.body).to.have.property("success").to.be.true;
				done();
			});
	});

	it("create transaction with negative amount. should return not ok", function (done) {
		var transaction = node.crypti.transaction.createTransaction("1C", -1, node.peers_config.account);
		node.peer.post('/transactions')
			.set('Accept', 'application/json')
			.send({
				transaction: transaction
			})
			.expect('Content-Type', /json/)
			.expect(200)
			.end(function (err, res) {
				console.log(res.body);
				node.expect(res.body).to.have.property("success").to.be.false;
				node.expect(res.body).to.have.property("message");
				done();
			});
	});

	it("create transaction with recipient and then change it to verify signature. should return not ok", function (done) {
		var transaction = node.crypti.transaction.createTransaction("12C", 1, node.peers_config.account);
		transaction.recipientId = "1C";
		transaction.id = node.crypti.crypto.getId(transaction);
		node.peer.post('/transactions')
			.set('Accept', 'application/json')
			.send({
				transaction: transaction
			})
			.expect('Content-Type', /json/)
			.expect(200)
			.end(function (err, res) {
				console.log(res.body);
				node.expect(res.body).to.have.property("success").to.be.false;
				node.expect(res.body).to.have.property("message");
				done();
			});
	});

	it("create transaction with no balance on sender. should return not ok", function (done) {
		var transaction = node.crypti.transaction.createTransaction("1C", 1, "randomstring");
		node.peer.post('/transactions')
			.set('Accept', 'application/json')
			.send({
				transaction: transaction
			})
			.expect('Content-Type', /json/)
			.expect(200)
			.end(function (err, res) {
				console.log(res.body);
				node.expect(res.body).to.have.property("success").to.be.false;
				node.expect(res.body).to.have.property("message");
				done();
			});
	});

	it("create transaction with fake signature. should return not ok", function (done) {
		var transaction = node.crypti.transaction.createTransaction("12C", 1, node.peers_config.account);
		transaction.signature = crypto.randomBytes(64).toString('hex');
		transaction.id = node.crypti.crypto.getId(transaction);
		node.peer.post('/transactions')
			.set('Accept', 'application/json')
			.send({
				transaction: transaction
			})
			.expect('Content-Type', /json/)
			.expect(200)
			.end(function (err, res) {
				console.log(res.body);
				node.expect(res.body).to.have.property("success").to.be.false;
				node.expect(res.body).to.have.property("message");
				done();
			});
	});

	it("create transaction with no hex data for bytes values (public key/signature). should return not ok", function (done) {
		var transaction = node.crypti.transaction.createTransaction("12C", 1, node.peers_config.account);
		transaction.signature = node.randomPassword();
		transaction.senderPublicKey = node.randomPassword();
		node.peer.post('/transactions')
			.set('Accept', 'application/json')
			.send({
				transaction: transaction
			})
			.expect('Content-Type', /json/)
			.expect(200)
			.end(function (err, res) {
				console.log(res.body);
				node.expect(res.body).to.have.property("success").to.be.false;
				node.expect(res.body).to.have.property("message");
				done();
			});
	});

	it("send very large number in transaction. should return not ok", function (done) {
		var transaction = node.crypti.transaction.createTransaction("12C", 184819291270000000012910218291201281920128129, node.peers_config.account);
		node.peer.post('/transactions')
			.set('Accept', 'application/json')
			.send({
				transaction: transaction
			})
			.expect('Content-Type', /json/)
			.expect(200)
			.end(function (err, res) {
				console.log(res.body);
				node.expect(res.body).to.have.property("success").to.be.false;
				node.expect(res.body).to.have.property("message");
				done();
			});
	});

	it("send float number in transaction, should return not ok", function (done) {
		var transaction = node.crypti.transaction.createTransaction("12C", 1.3, node.peers_config.account);
		node.peer.post('/transactions')
			.set('Accept', 'application/json')
			.send({
				transaction: transaction
			})
			.expect('Content-Type', /json/)
			.expect(200)
			.end(function (err, res) {
				console.log(res.body);
				node.expect(res.body).to.have.property("success").to.be.false;
				node.expect(res.body).to.have.property("message");
				done();
			});
	});
});