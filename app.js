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
	
	
	function getYahooSnapshot(options) {

		return new Promise(function(resolve, reject) {
			
			var yahoo = require('yahoo-finance');
			
			yahoo.snapshot(options, function (error, snapshot) {

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
	
	
	function getSMAs(ticker, name, id) {
		var values = [];
		var counter = 0;
		var i;
		var sma10Counter = 0;
		var sma50Counter = 0;
		var sma200Counter = 0;
		var sma10 = 0;
		var sma50 = 0;
		var sma200 = 0;

		return new Promise(function(resolve, reject) {
		
			var today = getFormattedDate(new Date());
			var fromDate = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 290))); // Hämta minst 200 dagar
	
			getYahooHistorical({symbol:ticker, from:fromDate, to:today, period: 'd'}).then(function(quotes) {

				for (i = quotes.length-1; counter < 200 || counter < quotes.length; i--) {

					if (counter < 10) {
						if (typeof quotes[i] != 'undefined') {
							sma10 = sma10 + quotes[i].close;
							++sma10Counter;							
						}
					}
						
					if (counter < 50) {
						if (typeof quotes[i] != 'undefined') {
							sma50 = sma50 + quotes[i].close;						
							++sma50Counter;							
						}
					}
	
					if (counter < 200) {
						if (typeof quotes[i] != 'undefined') {
							sma200 = sma200 + quotes[i].close;						
							++sma200Counter;							
						}
					}
					
					if (counter == 6) {
						values[3] = quotes[i].close;						
					}

					if (counter == 13)
						values[4] = quotes[i].close;

					if (counter == 20)
						values[5] = quotes[i].close;
					
					++counter;
					
				}
												
				values[0] = sma10/sma10Counter;
				values[1] = sma50/sma50Counter;
				values[2] = sma200/sma200Counter;
				
				resolve({values:values, ticker:ticker, name:name, id:id});
			})
			.catch(function(error) {
				reject(error);
			});
			
		});

	}
	
	function getLatestQuote(ticker) {

		return new Promise(function(resolve, reject) {
		
			getYahooSnapshot({symbol:ticker, fields:['l1', 'p']}).then(function(snapshot) {
				console.log(ticker, snapshot.lastTradePriceOnly, snapshot.previousClose);
				resolve({quote:snapshot.lastTradePriceOnly, previousClose:snapshot.previousClose});
			})
			.catch(function(error) {
				reject(error);
			});		
		});

	}
	

	function listen() {
		
		app.set('port', (args.port || 3000));
		app.use(bodyParser.urlencoded({ limit: '50mb', extended: false }));
		app.use(bodyParser.json({limit: '50mb'}));
		app.use(cors());
		
		
		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar SMA 10, 50 eller 200 för ticker
		app.get('/sma/:count/:ticker', function (request, response) {
			var ticker = request.params.ticker;
			var count = request.params.count;
			var counter = 0;
			var i;
			var sma10 = 0;
			var sma50 = 0;
			var sma200 = 0;
			var v;
			
			console.log("Räknar ut SMA:s på ticker ", ticker);
			
			var today = getFormattedDate(new Date());
			var fromDate = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 290)));
			console.log(today, fromDate);						
			getYahooHistorical({symbol:ticker, from:fromDate, to:today, period: 'd'}).then(function(quotes) {
				
				console.log("Antal börsdagar :", quotes.length);
				
				for (i = quotes.length-1; counter < 200; i--) {
					
					if (counter < 10) {
						sma10 = sma10 + quotes[i].close;
					}
						
					if (counter < 50) {
						sma50 = sma50 + quotes[i].close;						
					}

					if (counter < 200) {
						sma200 = sma200 + quotes[i].close;						
					}
					
					++counter;
					
				}
				
				if (count == 10)												
					v = (sma10/10).toFixed(2).replace(".", ",");
				else if (count == 50)
					v = (sma50/50).toFixed(2).replace(".", ",");
				else if (count == 200)
					v = (sma200/200).toFixed(2).replace(".", ",");
				else
					v = -1;
				
				console.log(count, v);

				response.status(200).json(v);
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		})
		
		
		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar ATR(14) för ticker
		app.get('/atr/:ticker', function (request, response) {
			var ticker = request.params.ticker;
			var firstQuote = true;
			var atr;
			var atrPercent;
			var atrDate;
			var prevClose;
			var start;
			var i;
			
			console.log("Räknar ut ATR på ticker ", ticker);
			
			var today = getFormattedDate(new Date());
			var twoWeeksAgoish = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 23))); // Hämta 23 dagar tillbaks för att vara säker på att få 14 börsdagar

			getYahooHistorical({symbol:ticker, from:twoWeeksAgoish, to:today}).then(function(quotes) {

				start = Math.max(quotes.length - 14, 0);
				console.log("Start, quotes.length", start, quotes.length);
				for (i = start; i < quotes.length; ++i) {
					
					console.log(quotes[i]);
					
					if (firstQuote) {
						firstQuote = false;
						atr = quotes[i].high - quotes[i].low;
					}
					else {
						atr = atr + Math.max(quotes[i].high - quotes[i].low, Math.abs(quotes[i].high - prevClose), Math.abs(quotes[i].low - prevClose));						
					}
					
					prevClose = quotes[i].close;
				}
				
				// ATR(14)
				atr = atr / 14;
				
				// Omvandla till %
				atrPercent = (100 * (atr/quotes[i-1].close)).toFixed(2);
				
				atrDate = quotes[i-1].date.toISOString().substring(0, 10);

				console.log("ATR=", atr, " % ATR=", atrPercent, " datum=", atrDate);
								
				response.status(200).json({atr:atr, atrPercent:atrPercent, atrDate:atrDate});
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar stängningskurs för daysback
		app.get('/close/:daysback/:ticker', function (request, response) {
			var ticker = request.params.ticker;
			var daysback = request.params.daysback;
			var counter = 0;
			var i;
						
			var today = getFormattedDate(new Date());
			var atLeast21DaysBack = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 42))); // Hämta 42 dagar tillbaks för att vara säker på att få 21 börsdagar

			getYahooHistorical({symbol:ticker, from:atLeast21DaysBack, to:today}).then(function(quotes) {

				console.log("quotes.length", quotes.length);
				
				for (i = quotes.length-1; i > 0 && counter < daysback; --i) {
					++counter;
					console.log(quotes[i]);					
				}

				response.status(200).json(quotes[i+1].close.toFixed(2).replace(".", ","));
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		})
		
		
		// ----------------------------------------------------------------------------------------------------------------------------
		// Kollar om ticker finns, i så fall företagsnamn tillbaks
		app.get('/company/:ticker', function (request, response) {

			var ticker = request.params.ticker;
			console.log("Söker efter namn på ticker ", ticker);
			getYahooSnapshot({symbol:ticker, fields:['n']}).then(function(snapshot) {
				response.status(200).json(snapshot.name);
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		})
		
		
		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar alla index som screenas 
		app.get('/watches', function (request, response) {
			var result = [];
			var tickersComplete = 0;
			
			_pool.getConnection(function(err, connection) {
				if (!err) {					
					console.log("Hämtar alla bevakningar från DB.");
					connection.query('SELECT * FROM bevakning ORDER BY id', function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
								
								for (var i = 0; i < rows.length; i++) {

									getSMAs(rows[i].ticker, rows[i].namn).then(function(values) {
										getLatestQuote(values.ticker).then(function(quotes) {
											
											values.quote = quotes.quote;
											values.previousClose = quotes.previousClose;
											result.push(values);
											
											tickersComplete++;
											
											if (tickersComplete == rows.length)
												response.status(200).json(result);
											
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
		app.get('/trawl', function (request, response) {
			var result = [];
			var tickersComplete = 0;
			
			_pool.getConnection(function(err, connection) {
				if (!err) {					
					console.log("Hämtar allt från trålen.");
					connection.query('SELECT * FROM trawl', function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
								
								for (var i = 0; i < rows.length; i++) {

									getSMAs(rows[i].ticker, "", rows[i].id).then(function(values) {
										getLatestQuote(values.ticker).then(function(quotes) {

											values.quote = quotes.quote;
											values.previousClose = quotes.previousClose;
											result.push(values);
											
											tickersComplete++;
											
											if (tickersComplete == rows.length)
												response.status(200).json(result);
											
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
		// Returnerar alla aktier med aktuell kurs och utfall i % mot köp
		app.get('/stocks', function (request, response) {
			
			_pool.getConnection(function(err, connection) {
				if (!err) {					
					console.log("Hämtar alla aktier från DB.");
					connection.query('SELECT * FROM aktier WHERE såld=0', function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
								var tickerCheckList = [];
								
								for (var i = 0; i < rows.length; i++) {
									tickerCheckList[i] = rows[i].ticker;	
								};					
																		
								yahooFinance.snapshot({
								  symbols: tickerCheckList,
								  fields: ['l1', 'm3', 'm4', 'p']
								}, function (err, snapshot) {
									if (err) {
										console.log(err);	
										response.status(404).json({error:err});						
									}
									else {
										var percentage;
										
										for (var i = 0; i < Object.keys(snapshot).length; i++) {
											rows[i].senaste = snapshot[i].lastTradePriceOnly;
											rows[i].sma50 = snapshot[i]['50DayMovingAverage'];
											rows[i].sma200 = snapshot[i]['200DayMovingAverage'];
											// Beräkna % med 2 decimaler
											percentage = (1 - (rows[i].kurs/snapshot[i].lastTradePriceOnly)) * 100;
											rows[i].utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
											rows[i].atrStoploss = (rows[i].ATR * rows[i].ATRMultipel) / snapshot[i].previousClose;
											console.log(rows[i].ATR, rows[i].ATRMultipel, snapshot[i].previousClose);
										}
										response.status(200).json(rows);							
									}
								});
							}
							else
								response.status(200).json([]);
						}
						else {
							console.log("SELECT * FROM aktier misslyckades: ", error);
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
							// Aktien finns
							if (post.antal > 0) {
								// Räkna ut nytt anskaffningsvärde
								console.log("Aktien finns, uppdaterar: ", post, rows[0].id);
								post.antal = (+post.antal) + (+rows[0].antal);
								
								var pkurs = parseFloat(post.kurs);
								var pantal = parseFloat(post.antal);
								var rkurs = parseFloat(rows[0].kurs);
								var rantal = parseFloat(rows[0].antal);
								
								post.kurs = (((parseFloat(pkurs) * parseFloat(pantal)) + (parseFloat(rkurs) * parseFloat(rantal))) / (parseFloat(pantal) + parseFloat(rantal))).toFixed(4);								
							}
							else {
								// Vi ska bara uppdatera stop loss, så behåll ursprungligt antal och kurs
								console.log("Antal är 0, vi sparar med ny stop loss: ", post, rows[0].id);
								post.antal = rows[0].antal;
								post.kurs = rows[0].kurs;
							}
							
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

							// Aktien finns inte, lägg upp den
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
		var worker = new Worker(_pool);
		
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
