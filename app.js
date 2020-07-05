#!/usr/bin/env node

var express = require('express');
var app = express();
var cors = require('cors');
var sprintf = require('yow').sprintf;
var prefixConsole = require('yow/prefixConsole');
var bodyParser = require('body-parser');
var yahooFinance = require('yahoo-finance');
var config = require('./config.js');
var mySQL = require('mysql');
var tokens = require('./tokens.js');

const puppeteer = require('puppeteer');


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


var _SPYValues = [];


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


	function getSPY30Days(connection) {
		var i;

		return new Promise(function(resolve, reject) {
		
			_SPYValues = [];
	
			var today = getFormattedDate(new Date());
			var monthAgo = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 20))); // 20 dagar
	
			getYahooHistorical({symbol:'SPY', from: monthAgo, to: today, period: 'd'}).then(function(quotes) {
				
				for (i = 0; i < quotes.length; ++i) {		
					_SPYValues.push({close:quotes[i].close, date:quotes[i].date});
				}
				resolve();			
			})
			.catch(function(error) {
				console.log("ERR:getSPY30Days:getYahooHistorical");
				reject("getSPY30Days", error);
			});
			
		});

	}

	
	function datesEqual(d1, d2) {

		if (d1.getDate() == d2.getDate()) {
			if (d1.getMonth() == d2.getMonth()) {
				if (d1.getFullYear() == d2.getFullYear()) {
					return true;
				}
			}
		}

		return false;
	}
	
	
	function dateGreater(d1, d2) {

		if (d1.getFullYear() >= d2.getFullYear()) {
			if (d1.getMonth() >= d2.getMonth()) {
				if (d1.getDate() >= d2.getDate()) {
					return true;
				}
			}
		}

		return false;
	}


	function getSpyProgress(quotes) {
		var spyProgress = [];
		var spyPointer = 0;
		var tickerPointer = 0;
		var progressPointer = 0;
		var spyChange;
		var tickerChange;
		
		console.log("quotes", quotes);
		console.log("spyvalues", _SPYValues);
				
		do {
			if (datesEqual(_SPYValues[spyPointer].date, quotes[tickerPointer].date)) {

				tickerChange = 1 - (quotes[tickerPointer+1].close  / quotes[tickerPointer].close);
				spyChange    = 1 - (_SPYValues[spyPointer+1].close / _SPYValues[spyPointer].close);

				console.log("jämför", _SPYValues[spyPointer].date, quotes[tickerPointer].date, tickerChange, spyChange);
				
				spyProgress.push({name:_SPYValues[spyPointer].date, value:(tickerChange-spyChange)*100});
				
				// spyProgress[progressPointer++] = tickerChange-spyChange;
						
				++tickerPointer;				
				++spyPointer;				
			}
			else if (dateGreater(_SPYValues[spyPointer].date, quotes[tickerPointer].date))
				++tickerPointer;				
			else 
				++spyPointer;
		
		} while (spyPointer < 10 && tickerPointer < 10 && typeof _SPYValues[spyPointer].date != 'undefined' && quotes[tickerPointer] != 'undefined');		
		
		// Senaste värdet sist
		spyProgress = spyProgress.reverse();
		
		console.log("spyprogress", spyProgress);
		
		return spyProgress;
	}

	
	function setSPYScore(values) {
		var spyPointer = 1;
		var tickerPointer = 1;
		var spyChange;
		var tickerChange;
		var scoreBefore = values.score;
				
		do {
			
//console.log(spyPointer, _SPYValues[spyPointer].date, tickerPointer, values.dates[tickerPointer]);

			if (_SPYValues[spyPointer].date.getTime() == values.dates[tickerPointer].getTime()) {
//console.log("Lika!");				
				spyChange    = 1 - (_SPYValues[spyPointer-1].close / _SPYValues[spyPointer].close);
				tickerChange = 1 - (values.closes[tickerPointer-1]  / values.closes[tickerPointer]);
//console.log("spyChange", spyChange, "tickerChange", tickerChange);			
					if (tickerChange > spyChange)
						++values.score;
					else
						--values.score;					
						
				++tickerPointer;				
				++spyPointer;				
			}
			else if (_SPYValues[spyPointer].date > values.dates[tickerPointer])
				++tickerPointer;				
			else 
				++spyPointer;
		
		} while (spyPointer < 30 && tickerPointer < 30);
		
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
	
	function toDate(dateStr) {
		var parts = dateStr.split("-")
		return new Date(parts[2], parts[1] - 1, parts[0])
	}	
	
	function minDate(d1, d2) {
		var date1Updated = new Date(d1.replace(/-/g,'/'));  
		var date2Updated = new Date(d2.replace(/-/g,'/'));
		
		if (date1Updated > date2Updated)
			return d2;
		else
			return d1;
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
		var values = {};
		var volumes = [];
		var closes = [];
		var dates = [];
		var weeklyPL = [];
		var j = 1;
		var scoreBefore;
		
		return new Promise(function(resolve, reject) {

			_poolMunch.getConnection(function(err, connection) {
				if (!err) {
					console.log("--- Hämtar indikatorer för", ticker);
					connection.query('SELECT * FROM stocks WHERE symbol=?', ticker, function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
								
								values.score = 0;
								
								values.SMA10 =  rows[0].SMA10;
								values.SMA50 =  rows[0].SMA50;
								values.SMA200 = rows[0].SMA200;

								values.ATR14 = rows[0].ATR14;
								
								connection.query('select * from quotes where symbol = ? order by date desc limit 60', rows[0].symbol, function(error, rows, fields) { // Hämta de 30 senaste dagsnoteringarna
									if (!error) {
										if (rows.length > 0) {
											
											// ATR i %
											values.ATR14 = (100 * values.ATR14 / rows[0].close).toFixed(2);
																						
											scoreBefore = values.score;

											for (i = 0; i < 30; i++) {
												volumes[i] = rows[i].volume; // 30 senaste dagars volym
												closes[i]  = rows[i].close;  // 30 senaste dagars close
												dates[i]   = rows[i].date;
												
												// Spara uppgången för de senaste sex 5-dagarsintervallen, dvs dag1 - dag5 = utfall%, dag6 - 10 = utfall%, osv
												if ((i % 5) == 0) {
													weeklyPL.push({name:'v'+j, yield:Number(((1 - (rows[i+4].close/rows[i].close)) * 100).toFixed(2))});
													
													if (weeklyPL[weeklyPL.length-1].yield > 0)
														++values.score; // Poäng för varje positiv 5-dagarsperiod
													
													++j;													
												}
											}
											
											console.log(ticker, "fick", values.score - scoreBefore, "poäng för 5-dagars avkastning.");


											for (i = 30; i < 60; i++) {
												closes[i] =  rows[i].close;  // 31-60 senaste dagars close												
											}

											values.volumes = volumes.reverse(); // Äldsta värdet först
											values.closes = closes.reverse();
											values.dates = dates.reverse();
											values.weeklyPL = weeklyPL;

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
								values.SMA10 =  0;
								values.SMA50 =  0;
								values.SMA200 = 0;
								values.close7 = 0;
								values.close14 = 0;
								values.close21 = 0;
								values.ATR14 = 0;
								values.score = 0;
								values.volumes = Array.apply(null, Array(30)).map(Number.prototype.valueOf,0);
								values.closes = Array.apply(null, Array(30)).map(Number.prototype.valueOf,0);
								
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

	};
		
	function isCurrency(ticker) {
		return (ticker == 'SEK=X' || ticker == 'CADSEK=X' || ticker == 'EURSEK=X');
	}
	
	function getIndicators(quotes) {
		var i;
		var atr;
		var vol = 0;
		var sma10 = 0;
		var sma20 = 0;		
		var firstQuote = true;

		for (i = 0; i < Math.min(quotes.length, 25); ++i) {
			
			if (i < 10)
				sma10 = sma10 + quotes[i].close;

			if (i < 20)
				sma20 = sma20 + quotes[i].close;
			
			if (i < 14) {				
				if (firstQuote) {
					firstQuote = false;
					atr = quotes[i].high - quotes[i].low;
				}
				else {
					atr = atr + Math.max(quotes[i].high - quotes[i].low, Math.abs(quotes[i].high - prevClose), Math.abs(quotes[i].low - prevClose));						
				}
				
				prevClose = quotes[i].close;
				
				vol = vol + quotes[i].volume;
			}

		}
			
		return {
		        atr14: (atr / 14).toFixed(2),
		        av14: Math.round(vol / 14),
		        sma10: (sma10 / 10).toFixed(2),
		        sma20: (sma20 / 20).toFixed(2)		        
		};		
		
	}

	function listen() {

		app.set('port', (args.port || 3000));
		app.use(bodyParser.urlencoded({ limit: '50mb', extended: false }));
		app.use(bodyParser.json({limit: '50mb'}));
		app.use(cors());

/* gamla /company innan sma20
		app.get('/company/:ticker', function (request, response) {

			var ticker = request.params.ticker;

			_poolMunch.getConnection(function(err, connection) {
				if (!err) {
					connection.query('SELECT * FROM stocks WHERE symbol=?', ticker, function(error, rows, fields) {
						if (!error) {
							getYahooQuote({symbol:ticker, modules: ['price', 'summaryDetail', 'summaryProfile', 'financialData', 'recommendationTrend', 'earnings', 'upgradeDowngradeHistory', 'defaultKeyStatistics',  'calendarEvents']}).then(function(snapshot) {
								var misc = {};

								if (rows.length > 0) {
									misc.atr14 = rows[0].ATR14;
									misc.sma10 = rows[0].SMA10;
									misc.av14 = rows[0].AV14;

									snapshot.misc = misc;		

									response.status(200).json(snapshot);
									
								}
								else {
									var today = getFormattedDate(new Date());
									var monthAgo = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 23)));

									getYahooHistorical({symbol:ticker, from: monthAgo, to: today, period: 'd'}).then(function(quotes) {
										var indicators = getIndicators(quotes);
										misc.atr14 = indicators.atr14;
										misc.av14  = indicators.av14;
										misc.sma10 = indicators.sma10;										
																														
										snapshot.misc = misc;		

										response.status(200).json(snapshot);

									})
									.catch(function(error) {
										response.status(404).json(['getYahooHistorical failed.']);
									});									

								}

							})
							.catch(function(error) {
								response.status(404).json(['getYahooQuote failed.']);
							});
						}
						else {
							console.log("SELECT * FROM stocks misslyckades: ", error);
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
*/
		
		app.get('/company/:ticker', function (request, response) {

			var ticker = request.params.ticker;

			_poolMunch.getConnection(function(err, connection) {
				if (!err) {
					connection.query('SELECT * FROM stocks WHERE symbol=?', ticker, function(error, rows, fields) {
						if (!error) {
							getYahooQuote({symbol:ticker, modules: ['price', 'summaryDetail', 'summaryProfile', 'financialData', 'recommendationTrend', 'earnings', 'upgradeDowngradeHistory', 'defaultKeyStatistics',  'calendarEvents']}).then(function(snapshot) {
								var today = getFormattedDate(new Date());
								var monthAgo = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 30))); // 30 dagar tillbaks

								getYahooHistorical({symbol:ticker, from: monthAgo, to: today, period: 'd'}).then(function(quotes) {
									var misc = {};
									var indicators = getIndicators(quotes);

									if (rows.length > 0) {
										// Ticker finns i munch och får värden från tabellen stocks i Munch
										misc.atr14 = rows[0].ATR14;
										misc.av14 = rows[0].AV14;											
										misc.sma10 = rows[0].SMA10;
										misc.sma20 = rows[0].SMA20;										
									} else {
										// Vi har själva räknat ut värdena i getIndicators
										misc.atr14 = indicators.atr14;
										misc.av14  = indicators.av14;
										misc.sma10 = indicators.sma10;																				
										misc.sma20 = indicators.sma20;										
									}
																													
									snapshot.misc = misc;		

									response.status(200).json(snapshot);

								})
								.catch(function(error) {
									response.status(404).json(['getYahooHistorical failed.']);
								});									
							})
							.catch(function(error) {
								response.status(404).json(['getYahooQuote failed.']);
							});
						}
						else {
							console.log("SELECT * FROM stocks misslyckades: ", error);
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
		
		// BEGIN MEG

		app.get('/mysql', function(request, response) {

			try {
				var MySQL = require('mysql');

				var database  = request.params.database;
				var context   = extend({}, request.body, request.query);

				function connect() {

					return new Promise(function(resolve, reject) {

						var options = {};
						options.host     = tokens.HOST;
						options.user     = tokens.USER;
						options.password = tokens.PW;
						options.database = 'munch';

						var mysql = MySQL.createConnection(options);

						mysql.connect(function(error) {
							if (error) {
								reject(error);
							}
							else {
								resolve(mysql);
							}

						});
					});

				}

				function query(mysql) {

					return new Promise(function(resolve, reject) {

						var options = context.query;

						if (typeof options == 'string') {
							options = {sql:options};
						}

						var query = mysql.query(options, function(error, results, fields) {
							if (error)
								reject(error);
							else
								resolve(results);
						});


					});
				}

				connect().then(function(mysql) {

					query(mysql).then(function(result) {
						response.status(200).json(result);
					})
					.catch(function(error) {
						response.status(401).json({error:error.message});
					})
					.then(function() {
						mysql.end();
					});
				})
				.catch(function(error) {
					response.status(401).json({error:error.message});

				})
			}
			catch(error) {
				response.status(401).json({error:error.message});

			}
		});


		// END MEG

		// ----------------------------------------------------------------------------------------------------------------------------
		// Kollar om ticker finns på Yahoo, i så fall all info tillbaks
		app.get('/rawdump/:ticker', function (request, response) {

			var ticker = request.params.ticker;
			
			getYahooQuote({symbol:ticker, modules: ['price', 'summaryDetail', 'summaryProfile', 'financialData', 'recommendationTrend', 'earnings', 'upgradeDowngradeHistory', 'defaultKeyStatistics',  'calendarEvents']}).then(function(snapshot) {
				response.status(200).json(snapshot);
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Hämtar ATR för ticker
		app.get('/atr/:ticker', function (request, response) {

			var ticker = request.params.ticker;

			_poolMunch.getConnection(function(err, connection) {
				if (!err) {
					connection.query('SELECT * FROM stocks WHERE symbol=?', ticker, function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
							
								getYahooQuote({symbol:ticker, modules: ['price', 'calendarEvents']}).then(function(snapshot) {
									console.log("ATR14=", rows[0].ATR14, "Close day before=", snapshot.price.regularMarketPreviousClose, "earningsDate=", snapshot.calendarEvents.earnings.earningsDate);
									atrPercentage = rows[0].ATR14 / snapshot.price.regularMarketPreviousClose;
									response.status(200).json({ATR:rows[0].ATR14, atrPercentage:atrPercentage, earningsDate:snapshot.calendarEvents.earnings.earningsDate, quote:snapshot.price.regularMarketPrice});
								})
								.catch(function(error) {
									response.status(200).json([]);
								});
							
							}
							else {
								console.log("Ticker not found.");
								response.status(200).json([]);								
							}
						}
						else {
							console.log("SELECT * FROM stocks misslyckades: ", error);
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
		// Kollar om ticker finns i munch/quotes
		app.get('/tickerexists/:ticker', function (request, response) {

			var ticker = request.params.ticker;

			console.log("----> Finns ticker", ticker, "?");

			_poolMunch.getConnection(function(err, connection) {
				if (!err) {
					connection.query('SELECT * FROM quotes WHERE symbol=?', ticker, function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0)
								response.status(200).json(rows[0].ATR14);
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
					console.log("----> Hämtar alla bevakningar från DB.");
					connection.query('SELECT * FROM bevakning', function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {

								for (var i = 0; i < rows.length; i++) {
									getSMAs(rows[i].ticker, rows[i].namn, "", rows[i].typ).then(function(values) {
										getYahooQuote({symbol:values.ticker, modules: ['price']}).then(function(snapshot) {
											
											values.quote =          snapshot.price.regularMarketPrice;
											values.previousClose =  snapshot.price.regularMarketPreviousClose;											
											//values.type = quotes.type;

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
		// Returnerar alla källor
		app.get('/sources', function (request, response) {

			_pool.getConnection(function(err, connection) {
				if (!err) {
					console.log("----> Hämtar alla källor från DB.");
					connection.query('SELECT * FROM källor', function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
								response.status(200).json(rows);
							}
							else
								response.status(200).json([]);
						}
						else {
							console.log("SELECT * FROM källor misslyckades: ", error);
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
			var volumeChange;

			var watchType = request.params.type;
			
			if (typeof watchType == 'undefined')
				watchType = 0;

			_pool.getConnection(function(err, connection) {
				if (!err) {
					console.log("----> Hämtar från trålen", watchType);
					
					getSPY30Days().then(function() {
					
						connection.query('SELECT * FROM trawl WHERE type=?', watchType, function(error, rows, fields) {
							if (!error) {
	
								var promise = Promise.resolve();
								
								rows.forEach(function(row) {
									promise = promise.then(function() {
										return getSMAs(row.ticker, "", row.id);
									})
									.then(function(values) {
										return getYahooQuote({symbol:values.ticker, modules: ['price', 'summaryDetail']}).then(function(snapshot) {
											var scoreBefore = 0;
											
											values.quote =          snapshot.price.regularMarketPrice;
											values.previousClose =  snapshot.price.regularMarketPreviousClose;
											values.namn =           snapshot.price.longName;

console.log("Volymer:", values.ticker, snapshot.summaryDetail.averageVolume, snapshot.summaryDetail.averageVolume10days, snapshot.price.regularMarketVolume);											
											
											// %-change between 10 day average and 30 day average
											volumeChange = 1 - (snapshot.summaryDetail.averageVolume/snapshot.summaryDetail.averageVolume10days);
											scoreBefore = values.values.score;
											
											// Ge poäng för volym (ökning sista 10 dagar mot 3 månaders snitt)
											if (volumeChange > 0.4) {values.score += 3;} else // > 40% -> 3 poäng
											if (volumeChange > 0.2) {values.score += 2;} else // > 20% -> 2 poäng
											if (volumeChange > 0.1) {values.score += 1;}      // > 10% -> 1 poäng

											// %-change between last day and 10 day average
											volumeChange = 1 - (snapshot.summaryDetail.averageVolume10days/snapshot.price.regularMarketVolume);
											if (volumeChange > 0.4) {values.score += 3;} else // > 40% -> 3 poäng
											if (volumeChange > 0.2) {values.score += 2;}	  // > 20% -> 2 poäng

											console.log(values.ticker, "fick", values.values.score - scoreBefore, "poäng för volym.");
																							
											scoreBefore = values.values.score;												
											setSPYScore(values.values);
											console.log(values.ticker, "fick", values.values.score - scoreBefore, "poäng för relativ styrka kontra SPY.");
																						
											result.push(values);
	
											return Promise.resolve();
										})
										.catch(function(error) {
											console.log("Catch getYahooQuote", error);
											response.status(200).json([]);
										})
										
									})
	
									
								});
								
								promise.then(function() {
									result.sort(function(a, b) {
										if (a.values.score > b.values.score)
											return -1;
										else												
											return 1;
	
										return 0;
									});		
									
									response.status(200).json(result);
									connection.release();
								
								})
								.catch(function(error) {
									response.status(200).json([]);
									connection.release();
								});
									
							}
							else {
								console.log("SELECT * FROM trawl misslyckades: ", error);
								response.status(200).json([]);
								connection.release();
							}
						});
					})
					.catch(function(error) {
						console.log("ERR: Kunde inte hämta getSPY30Days", error);
						response.status(200).json([]);
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
		// Returnerar Fear & Greed
		app.get('/fearandgreed', function (request, response) {

			(async () => {

				try {
					const browser = await puppeteer.launch({args: ['--no-sandbox']});
					const page = await browser.newPage();
					await page.goto('https://money.cnn.com/data/fear-and-greed/');	
					await page.waitFor(1000);
					
					const result = await page.evaluate(() => {
						var valueList;
						var str = [];
						
						valueList = document.querySelectorAll('#needleChart ul li');
												
						valueList.forEach(function (item, index) {
							item = item.innerHTML.split(":")[1];
							str.push(item.match(/[0-9]+/g)[0]);
						});
						
						return str;
					});
	
					await browser.close();
					
					response.status(200).json(result);
					
				} catch (error) {
					console.log("ERR:/fearandgreed", error);
					response.status(404).json(["ERR:/fearandgreed:" + error]);						
				}
			
			})();

		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar historisk data för ticker
		app.get('/history/:ticker', function (request, response) {

			var ticker  = request.params.ticker;			
			var today = getFormattedDate(new Date());
			var monthAgo = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 20))); // 20 dagar
	
			getYahooHistorical({symbol:ticker, from: monthAgo, to: today, period: 'd'}).then(function(quotes) {
				response.status(200).json(quotes);
			})
			.catch(function(error) {
				console.log("ERR:/history/:ticker");
				response.status(404).json([]);
			});			

		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar alla innehav
		app.get('/stocks', function (request, response) {

			_pool.getConnection(function(err, connection) {
				if (!err) {

					getSPY30Days().then(function() {
						var spyProgress = [];
																	
						connection.query('SELECT * FROM aktier WHERE såld=0', function(error, rows, fields) {
							if (!error) {
								if (rows.length > 0) {
	
									var promise = Promise.resolve();
																	
									rows.forEach(function(row) {
										promise = promise.then(function() {
											return getYahooQuote({symbol:row.ticker, modules: ['price', 'summaryDetail', 'summaryProfile', 'calendarEvents']});
										})
										.then(function(snapshot) {
											row.senaste = snapshot.price.regularMarketPrice;
											
											if (typeof snapshot.summaryProfile != 'undefined') {
												if (typeof snapshot.summaryProfile.sector != 'undefined') {
													row.sector = snapshot.summaryProfile.sector + '/' + snapshot.summaryProfile.industry;											
												}
											}										
											
											if (typeof snapshot.summaryDetail == 'undefined') {
												// Inte alla aktier har en summaryDetail, t ex svenska
												row.sma50 =   -1;
												row.sma200 =  -1;
											}
											else {
												row.sma50 =     snapshot.summaryDetail.fiftyDayAverage;
												row.sma200 =    snapshot.summaryDetail.twoHundredDayAverage;		
												row.utdelning = snapshot.summaryDetail.dividendYield * 100;
											}
												
											if (typeof snapshot.calendarEvents != 'undefined')
												row.earningsDate = snapshot.calendarEvents.earnings.earningsDate;
											else
												row.earningsDate = [];
																																		
											// Beräkna % med 2 decimaler
											percentage = ((snapshot.price.regularMarketPrice/row.kurs)-1) * 100;
											row.utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
											
											//row.atrStoploss = snapshot.price.regularMarketPreviousClose - (row.ATR * row.ATRMultipel);
											row.atrStoploss = row.maxkurs - (row.ATR * row.ATRMultipel);

											// Hämta senaste 30 börsdagar för alla tickers
											var today = getFormattedDate(new Date());
											var monthAgo = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 40)));
											
											return getYahooHistorical({symbol:row.ticker, from: monthAgo, to: today, period: 'd'});
												
										})
										.then(function(quoteData) {
											var quotes = [];
											var quotes2 = [];
											var i = 0;
											var sma20 = 0;
											
											quoteData.forEach(function(quote) {
												if (quote.close != null) {
													
													if (i < 20)
														sma20 = sma20 + quote.close;
													i = i + 1;
													
													quotes.push({close:quote.close, date:quote.date});											
													quotes2.push(quote.close);
												}
											})

											row.sma20 = (sma20/20).toFixed(2);
											row.quotes = quotes2.reverse();
											
											if (!isCurrency(row.ticker))
												row.spyProgress = getSpyProgress(quotes);
											else
												row.spyProgress = [];

											return Promise.resolve();
										});
									});
	
									promise.then(function() {
										response.status(200).json(rows);
									})
									.catch(function(error) {
										console.log("ERR:", error);
										response.status(200).json([]);
									});
	
								}
								else {
									console.log("Strecket: Inga aktier i databasen");
									response.status(200).json([]);								
								}
							}
							else {
								console.log("'SELECT * FROM aktier WHERE såld=0' misslyckades: ", error);
								response.status(200).json([]);
							}
							connection.release();
						});
					})
					.catch(function(error) {
						console.log("ERR: Kunde inte hämta getSPY30Days", error);
						response.status(200).json([]);
					});
					
				}
				else {
					console.log("Kunde inte skapa en connection: ", err);
					response.status(200).json([]);
				}
			});
		})


		// NEW sold_stocks
		// ----------------------------------------------------------------------------------------------------------------------------
		app.get('/sold_stocks', function (request, response) {

			_pool.getConnection(function(err, connection) {
				if (!err) {
					console.log("Hämtar alla sålda aktier från DB.");																	
					
					connection.query('SELECT aktier.*, källor.text FROM aktier JOIN källor ON källor.id = aktier.källa WHERE såld=1 AND såld_kurs IS NOT NULL ORDER BY såld_datum', function(error, rows, fields) {	
						if (!error) {
							if (rows.length > 0) {
	
								var promise = Promise.resolve();
																
								rows.forEach(function(row) {
									promise = promise.then(function() {
										return getYahooQuote({symbol:row.ticker, modules: ['price', 'summaryDetail', 'summaryProfile']});
									})
									.then(function(snapshot) {
										// Beräkna % med 2 decimaler
										var percentage = ((snapshot.price.regularMarketPrice/row.kurs)-1) * 100;
										row.utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
		
										// Hämta historiska kurser, minst 30 dagar
										var today = getFormattedDate(new Date());
										var monthAgo = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 40)));
										var buyDate = getFormattedDate(row.köpt_datum);
//console.log("minDate=", minDate(monthAgo, buyDate));
										return getYahooHistorical({symbol:row.ticker, from: minDate(monthAgo, buyDate), to: today, period: 'd'});
											
									})
									.then(function(quoteData) {
										var quotes = [];
//console.log("quoteData=", quoteData);
										row.max = 0;
										row.min = 999999;
	
										quoteData.forEach(function(quote, i) {
											//console.log("quote=", quote);
											// Räkna ut max och min-kurs under tiden vi hade aktien
											//console.log("såld_datum=", row.såld_datum, "quote=", quote.date);
											
											var d1 = new Date(row.såld_datum);
											var d2 = new Date(quote.date);
											
											//console.log("d1=", d1, "d2=", d2);
											if (d1 >= d2) {
												//console.log("I ägointervallet!");
												if (quote.high > row.max)
													row.max = quote.high;
													
												if (quote.low < row.min)
													row.min = quote.low;		
											}
											
											if (quote.close != null && i < 30) {
												//console.log("sparar=", quote.close, quote.date, "i=", i);
												quotes.push(quote.close);
											}
										})
//	console.log("max=", row.max, "min=", row.min );
										row.quotes  = quotes.reverse();
										
										percentage = ((row.max/row.kurs)-1) * 100;
										row.max = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);

										percentage = ((row.min/row.kurs)-1) * 100;
										row.min = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
										
//								  console.log("quotes=", quotes);
										return Promise.resolve();
									});
								});
	
								promise.then(function() {
									response.status(200).json(rows);
								})
								.catch(function(error) {
									console.log("ERR:", error);
									response.status(200).json([]);
								});
	
							}
							else {
								console.log("Strecket: Inga aktier i databasen");
								response.status(200).json([]);								
							}
						}
						else {
							console.log("'SELECT aktier.*, källor.text FROM aktier...' misslyckades: ", error);
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
		app.delete('/stocks/:id/date/:date/price/:price/amount/:amount', function (request, response) {

			var id  = request.params.id;
			var date = request.params.date; 
			var price = request.params.price;  

			console.log('Säljer aktie: ', request.params);

			_pool.getConnection(function(err, connection) {

				if (!err) {
					connection.query('UPDATE aktier SET såld=1, såld_datum=?, såld_kurs=? WHERE id=?', [date, price, id], function(err, result) {
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

		prefixConsole();
		
		listen();
		work();

	}

	run();
}

module.exports = new Server();
