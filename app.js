#!/usr/bin/env node

var express = require('express');
var app = express();
var cors = require('cors');
var sprintf = require('yow').sprintf;
var bodyParser = require('body-parser');
var redirectLogs = require('yow').redirectLogs;
var prefixLogs = require('yow').prefixLogs;
var yahooFinance = require('yahoo-finance');
var config = require('./config.js');
var mySQL = require('mysql');
var tokens = require('./tokens.js');


var _pool  = mySQL.createPool({
	host     : tokens.HOST,
	user     : tokens.USER,
	password : tokens.PW,
	database : 'strecket'
});


var _poolMunch  = mySQL.createPool({
	host     : tokens.HOST,
	user     : tokens.USER,
	password : tokens.PW,
	database : 'munch'
});


var Server = function(args) {

	args = parseArgs();

	function parseArgs() {
		var commander = require('commander');

		commander.version('1.0.0');
		commander.option('-l --log', 'redirect logs to file');
		commander.option('-p --port <port>', 'listens to specified port', 3000);
		commander.parse(process.argv);

		var args = ['port', 'log'];

		args.forEach(function(item) {
			args[item] = commander[item];
		});

		return args;
	}


	function getYahooHistorical(options) {

		return new Promise(function(resolve, reject) {

			var yahoo = require('yahoo-finance');

			yahoo.historical(options, function (error, quotes) {

				try {
					if (error)
						reject(error);
					else
						resolve(quotes);
				}
				catch (error) {
					reject(error);
				}

			});

		});
	}


	function getYahooQuote(options) {

		return new Promise(function(resolve, reject) {

			var yahoo = require('yahoo-finance');

			yahoo.quote(options, function (error, snapshot) {

				try {
					if (error)
						reject(error);
					else
						resolve(snapshot);
				}
				catch (error) {
					reject(error);
				}

			});

		});
	}


	function getFormattedDate(d) {
		var dd = d.getDate();
		var mm = d.getMonth()+1; //January is 0!
		var yyyy = d.getFullYear();

		if (dd < 10) {
		    dd = '0' + dd;
		}

		if(mm < 10) {
		    mm = '0' + mm;
		}

		return yyyy + '-' + mm + '-' + dd;
	}


	function getSMAs(ticker, name, id, type) {
		var values = [];
		var volumes = [];
		var closes = [];
		
		return new Promise(function(resolve, reject) {

			_poolMunch.getConnection(function(err, connection) {
				if (!err) {
					console.log("--- Hämtar SMA:s för", ticker);
					connection.query('SELECT * FROM stocks WHERE symbol=?', ticker, function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {

								values[0] = rows[0].SMA10;
								values[1] = rows[0].SMA50;
								values[2] = rows[0].SMA200;

								values[7] = rows[0].ATR14;

								connection.query('select * from quotes where symbol = ? order by date desc limit 30', rows[0].symbol, function(error, rows, fields) { // Hämta de 30 senaste dagsnoteringarna
									if (!error) {
										if (rows.length > 0) {
											values[3] = rows[6].close;  // Close 7 dagar sen
											values[4] = rows[13].close; // Close 14 dagar sen
											values[5] = rows[20].close; // Close 21 dagar sen

											values[7] = (100 * values[7] / rows[0].close).toFixed(2);

											for (i = 0; i < 30; i++) {
												volumes[i] = rows[i].volume; // 30 senaste dagars volym
												closes[i] =  rows[i].close;  // 30 senaste dagars close
											}
											
											values[6] = volumes.reverse(); // Äldsta värdet först
											values[8] = closes.reverse(); // Äldsta värdet först
											
											resolve({values:values, ticker:rows[0].symbol, name:name, id:id, type:type});											

										}
										else {
											console.log("select * from quotes where symbol = ? order by date desc limit 30", ticker, "returnerade inget.");
											reject(error);
										}
									}
									else {
										console.log("ERROR: select * from quotes where symbol = ? order by date desc limit 30", error);
										reject(error);
									}
								});

							}
							else {
								console.log("Ticker", ticker, "finns inte i 'stocks'.");
								
								// Gör en 'tom' retur 
								values[0] = 0;
								values[1] = 0;
								values[2] = 0;
								values[3] = 0;
								values[4] = 0;
								values[5] = 0;
								values[6] = Array.apply(null, Array(30)).map(Number.prototype.valueOf,0);
								values[7] = 0;
								values[8] = values[6].slice();
								
								resolve({values:values, ticker:ticker, name:"", id:id, type:type});
							}
						}
						else {
							console.log("SELECT * FROM stocks misslyckades: ", error);
							reject(error);
						}
						connection.release();
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					reject(error);
				}
			});

		});

	}


	function listen() {

		app.set('port', (args.port || 3000));
		app.use(bodyParser.urlencoded({ limit: '50mb', extended: false }));
		app.use(bodyParser.json({limit: '50mb'}));
		app.use(cors());


		// ----------------------------------------------------------------------------------------------------------------------------
		// Kollar om ticker finns på Yahoo, i så fall företagsnamn tillbaks
		app.get('/company/:ticker', function (request, response) {

			var ticker = request.params.ticker;
			console.log("Söker efter namn på ticker", ticker);
			getYahooQuote({symbol:ticker, modules: ['price']}).then(function(snapshot) {
				response.status(200).json(snapshot.price.shortName);
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Kollar om ticker finns i munch/quotes
		app.get('/tickerexists/:ticker', function (request, response) {

			var ticker = request.params.ticker;

			console.log("Finns ticker", ticker, "?");

			_poolMunch.getConnection(function(err, connection) {
				if (!err) {
					connection.query('SELECT * FROM quotes WHERE symbol=?', ticker, function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0)
								response.status(200).json(ticker);
							else
								response.status(200).json([]);
						}
						else {
							console.log("SELECT * FROM quotes misslyckades: ", error);
							response.status(200).json([]);
						}
						connection.release();
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(200).json([]);
				}
			});

		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar alla index som screenas
		app.get('/watches', function (request, response) {
			var result = [];
			var tickersComplete = 0;

			_pool.getConnection(function(err, connection) {
				if (!err) {
					console.log("--- Hämtar alla bevakningar från DB.");
					connection.query('SELECT * FROM bevakning', function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {

								for (var i = 0; i < rows.length; i++) {
									getSMAs(rows[i].ticker, rows[i].namn, "", rows[i].typ).then(function(values) {
										getYahooQuote({symbol:values.ticker, modules: ['price']}).then(function(snapshot) {
											
											values.quote = quotes.quote;
											values.previousClose = quotes.previousClose;
											values.type = quotes.type;

											result.push(values);

											tickersComplete++;

											if (tickersComplete == rows.length) {
												result.sort(function(a, b) {
													var typeA=a.type.toLowerCase();
													var typeB=b.type.toLowerCase();
													var nameA=a.name.toLowerCase();
													var nameB=b.name.toLowerCase();

													if (typeA < typeB) //sort string ascending
														return -1;
													if (typeA > typeB)
														return 1;
													// Samma typ, sortera på namn
													if (nameA < nameB)
														return -1;
													if (nameA > nameB)
														return 1;

													return 0;
												});

												response.status(200).json(result);
											}

										})
										.catch(function(error) {
											console.log("Kunde inte hämta senaste kurs: ", error);
											response.status(200).json([]);
										});

									})
									.catch(function(error) {
										console.log("Kunde inte hämta SMA:s: ", error);
										response.status(200).json([]);
									});

								};
							}
							else
								response.status(200).json([]);
						}
						else {
							console.log("SELECT * FROM bevakning misslyckades: ", error);
							response.status(200).json([]);
						}
						connection.release();
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(200).json([]);
				}
			});
		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar allt i trålen
		app.get('/trawl/:type', function (request, response) {
			var result = [];
			var tickersComplete = 0;
			var watchType;

			var watchType = request.params.type;
			
			if (typeof watchType == 'undefined')
				watchType = 0;

			_pool.getConnection(function(err, connection) {
				if (!err) {
					console.log("--- Hämtar från trålen.", watchType);
					connection.query('SELECT * FROM trawl WHERE type=?', watchType, function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {

								for (var i = 0; i < rows.length; i++) {
									getSMAs(rows[i].ticker, "", rows[i].id).then(function(values) {
										getYahooQuote({symbol:values.ticker, modules: ['price']}).then(function(snapshot) {

											values.quote =          snapshot.price.regularMarketPrice;
											values.previousClose =  snapshot.price.regularMarketPreviousClose;
											values.namn =           snapshot.price.longName;

											values[7] = (100 * (values[7]/values.quote)).toFixed(2) // ATR14 visas i %

											result.push(values);

											tickersComplete++;

											if (tickersComplete == rows.length) {
												result.sort(function(a, b) {
													var nameA=a.namn.toLowerCase();
													var nameB=b.namn.toLowerCase();

													if (nameA < nameB)
														return -1;
													if (nameA > nameB)
														return 1;

													return 0;
												});

												response.status(200).json(result);
											}

										})
										.catch(function(error) {
											console.log("Kunde inte hämta senaste kurs: ", error);
											response.status(200).json([]);
										});

									})
									.catch(function(error) {
										console.log("Kunde inte hämta SMA:s: ", error);
										response.status(200).json([]);
									});

								};
							}
							else
								response.status(200).json([]);
						}
						else {
							console.log("SELECT * FROM trawl misslyckades: ", error);
							response.status(200).json([]);
						}
						connection.release();
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(200).json([]);
				}
			});
		})



		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar aktien med id
		app.get('/stock/:id', function (request, response) {

			var id  = request.params.id;

			_pool.getConnection(function(err, connection) {
				if (!err) {
					console.log("Hämtar aktien med id=", id);
					connection.query('SELECT * FROM aktier WHERE såld=0 AND id=' + id, function(error, row, fields) {
						if (!error) {
							if (row.length > 0) {
								response.status(200).json(row);
							}
							else
								response.status(200).json([]);
						}
						else {
							console.log("Query mot DB misslyckades", error);
							response.status(200).json([]);
						}
						connection.release();
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(200).json([]);
				}
			});
		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar alla aktier med aktuell kurs och utfall i % mot köp
		app.get('/stocks', function (request, response) {

			_pool.getConnection(function(err, connection) {
				if (!err) {
					console.log("Hämtar alla aktier från DB.");
					connection.query('SELECT * FROM aktier WHERE såld=0', function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {

								var promise = Promise.resolve();

								rows.forEach(function(row) {
									promise = promise.then(function() {
										return getYahooQuote({symbol:row.ticker, modules: ['price', 'summaryDetail']});
									})
									.then(function(snapshot) {
										row.senaste = snapshot.price.regularMarketPrice;
										row.sma50 =   snapshot.summaryDetail.fiftyDayAverage;
										row.sma200 =  snapshot.summaryDetail.twoHundredDayAverage;
										
										// Beräkna % med 2 decimaler
										percentage = (1 - (row.kurs/snapshot.price.regularMarketPrice)) * 100;
										row.utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
										row.atrStoploss = (row.ATR * row.ATRMultipel) / snapshot.price.regularMarketPreviousClose;
										
										return Promise.resolve();
									});
								});

								promise.then(function() {
									response.status(200).json(rows);
								})
								.catch(function(error) {
									response.status(200).json([]);
								});

							}
							else
								response.status(200).json([]);
						}
						else {
							console.log("'SELECT * FROM aktier WHERE såld=0' misslyckades: ", error);
							response.status(200).json([]);
						}
						connection.release();
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(200).json([]);
				}
			});
		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Sparar ticker till trålen
		app.post('/savetrawl', function (request, response) {

			var post  = request.body;

			console.log("Sparar till trålen: ", post);

			_pool.getConnection(function(err, connection) {

				if (!err) {
					connection.query('INSERT INTO trawl SET ?', post, function(err, result) {
						if (err)
							response.status(404).json({error:err});
						else
							response.status(200).json({status:result});

						connection.release();
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(404).json({error:err});
				}
			});
		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Sparar ny aktie, finns den redan räkna ut genomsnittligt anskaffningsvärde
		app.post('/save', function (request, response) {

			var post  = request.body;

			console.log("Sparar aktie: ", post);

			_pool.getConnection(function(err, connection) {

				if (!err) {

					connection.query('SELECT * FROM aktier WHERE såld=0 AND ticker=?', post.ticker, function(err, rows) {
						if (rows.length > 0) {
							console.log("Aktien finns, uppdaterar: ", post);

							connection.query('UPDATE aktier SET ? WHERE id=?', [post, rows[0].id], function(err, result) {
								if (err)
									response.status(404).json({error:err});
								else
									response.status(200).json({status:result});

								connection.release();
							});

						}
						else {
							console.log("Aktien finns inte, skapar ny: ", post);

							connection.query('INSERT INTO aktier SET ?, köpt_datum=NOW()', post, function(err, result) {
								if (err)
									response.status(404).json({error:err});
								else
									response.status(200).json({status:result});

								connection.release();
							});
						}
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(404).json({error:err});
				}
			});
		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Säljer aktie
		app.delete('/stocks/:id', function (request, response) {

			var id  = request.params.id;

			console.log('Säljer aktie: ', id);

			_pool.getConnection(function(err, connection) {

				if (!err) {
					connection.query('UPDATE aktier SET såld=1, såld_datum=NOW() WHERE id=?', id, function(err, result) {
						if (err)
							response.status(404).json({error:err});
						else
							response.status(200).json({status:result});

						connection.release();
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(404).json({error:err});
				}
			});
		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Tar bort aktie ur trålen
		app.delete('/trawl/:id', function (request, response) {

			var id  = request.params.id;

			console.log('Tar bort aktie ur trålen: ', id);

			_pool.getConnection(function(err, connection) {

				if (!err) {
					connection.query('DELETE FROM trawl WHERE id=?', id, function(err, result) {
						if (err)
							response.status(404).json({error:err});
						else
							response.status(200).json({status:result});

						connection.release();
					});
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(404).json({error:err});
				}
			});
		})


		app.listen(app.get('port'), function() {
			console.log("Node app is running on port " + app.get('port'));
		});

	};


	function work() {
		var Worker = require('./worker.js');
		var worker = new Worker(_pool, _poolMunch);

		worker.run();
	}


	function run() {

		prefixLogs();

		if (args.log) {
			redirectLogs();
		}

		listen();
		work();

	}

	run();
}

module.exports = new Server();
