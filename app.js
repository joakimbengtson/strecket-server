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
	
	
	function getYahooSnapshot(options) {

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
	
	/* OLD getSMAs
	function getSMAs(ticker, name, id, type) {
		var values = [];
		var volumes = []; 
		var closes = []; 
		var counter = 0;
		var i;
		var sma10Counter = 0;
		var sma50Counter = 0;
		var sma200Counter = 0;
		var volumeCounter = 0;
		var volumeAdder = 0;
		var sma10 = 0;
		var sma50 = 0;
		var sma200 = 0;
		var firstQuote = true;
		var prevClose;
		var atr;

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
							
							// Spara stängningskurs för vektor med kurser -> graf
							closes[sma50Counter] = quotes[i].close;

							sma50 = sma50 + quotes[i].close;						
							++sma50Counter;			

							volumeAdder = volumeAdder + quotes[i].volume;
							
							if ((sma50Counter % 5) == 0) {
								// Spara snittet på volymen de senaste 5 dagarna
								volumes[volumeCounter] = Math.floor(volumeAdder/5);
								volumeAdder = 0;
								++volumeCounter;
							}
																		
						}
					}
	
					if (counter < 200) {
						if (typeof quotes[i] != 'undefined') {
							sma200 = sma200 + quotes[i].close;						
							++sma200Counter;														
						}
					}
					
					// Returnera stängning 7, 14 och 21 dagar tillbaks
					if (counter == 6) {
						if (typeof quotes[i] != 'undefined')
							values[3] = quotes[i].close;
					}

					if (counter == 13) {
						if (typeof quotes[i] != 'undefined')
							values[4] = quotes[i].close;
					}

					if (counter == 20) {
						if (typeof quotes[i] != 'undefined')
							values[5] = quotes[i].close;
					}
					
					// Beräkna atr(14)
					if (counter < 14) {
						if (typeof quotes[i] != 'undefined') {
							if (firstQuote) {
								firstQuote = false;
								atr = quotes[i].high - quotes[i].low;
							}
							else {
								atr = atr + Math.max(quotes[i].high - quotes[i].low, Math.abs(quotes[i].high - prevClose), Math.abs(quotes[i].low - prevClose));						
							}
							
							prevClose = quotes[i].close;
						}
					}
					
					++counter;
					
				}

				values[0] = sma10/sma10Counter;
				values[1] = sma50/sma50Counter;
				values[2] = sma200/sma200Counter;

				values[6] = volumes.reverse(); // Äldsta värdet först
				values[8] = closes.reverse(); // Äldsta värdet först

				if (typeof quotes[quotes.length-1] != 'undefined')
					values[7] = (100 * ((atr/14)/quotes[quotes.length-1].close)).toFixed(2); // Visa ATR som %
				else
					values[7] = 0;
					
				resolve({values:values, ticker:ticker, name:name, id:id, type:type});
			})
			.catch(function(error) {
				reject(error);
			});
			
		});

	} */

	function getSMAs(ticker, name, id, type) {
		var values = [];
		var volumes = []; 
		var closes = []; 
		var counter = 0;
		var sma10 = 0;
		var sma50 = 0;
		var sma200 = 0;
		var firstQuote = true;
		var prevClose;
		var atr;

		return new Promise(function(resolve, reject) {

			_poolMunch.getConnection(function(err, connection) {
				if (!err) {					
					console.log("connection till munch öppnad!"); 
					connection.query('SELECT * FROM stocks WHERE symbol=?', ticker, function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
																
								values[0] = rows[0].SMA10;
								values[1] = rows[0].SMA50;
								values[2] = rows[0].SMA200;
								
								values[7] = rows[0].ATR14;
								
								connection.query('select * from quotes where symbol = ? order by date desc limit 30', ticker, function(error, rows, fields) { // Hämta de 30 senaste dagsnoteringarna
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
							
											console.log("closes", values[8], closes);
											
										}
										else {
											console.log("select * from quotes where symbol = ? order by date desc limit 30", ticker, "returnerade inget.");
											response.status(200).json([]);
										}
									}
									else {
										console.log("ERROR: select * from quotes where symbol = ? order by date desc limit 30", error);
										response.status(200).json([]);					
									}	
								});
									
								resolve({values:values, ticker:ticker, name:name, id:id, type:type});
								
							}
							else {
								console.log("SELECT * FROM stocks WHERE symbol =", ticker, "returnerade inget.");
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
			
		});

	}

	
	function getLatestQuote(ticker, type) {

		return new Promise(function(resolve, reject) {
		
			getYahooSnapshot({symbol:ticker, modules: ['price']}).then(function(snapshot) {
				resolve({quote:snapshot.price.regularMarketPrice, previousClose:snapshot.price.regularMarketPreviousClose, company:snapshot.price.longName, type:type});
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
		
		/*
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
				
				response.status(200).json(v);
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		})
		*/
		
		/*
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
				}

				response.status(200).json(quotes[i+1].close.toFixed(2).replace(".", ","));
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		})*/
		
		/*
		// ----------------------------------------------------------------------------------------------------------------------------
		// Kollar om ticker finns på Yahoo, i så fall företagsnamn tillbaks
		app.get('/company/:ticker', function (request, response) {

			var ticker = request.params.ticker;
			console.log("Söker efter namn på ticker", ticker);
			getYahooSnapshot({symbol:ticker, fields:['n']}).then(function(snapshot) {
				response.status(200).json(snapshot.name);
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		}) */


		// ----------------------------------------------------------------------------------------------------------------------------
		// Kollar om ticker finns på Yahoo, i så fall företagsnamn tillbaks
		app.get('/company/:ticker', function (request, response) {

			var ticker = request.params.ticker;
			console.log("Söker efter namn på ticker", ticker);
			getYahooSnapshot({symbol:ticker, modules: ['price']}).then(function(snapshot) {
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
					console.log("Hämtar alla bevakningar från DB.");
					connection.query('SELECT * FROM bevakning', function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
								
								for (var i = 0; i < rows.length; i++) {
									getSMAs(rows[i].ticker, rows[i].namn, "", rows[i].typ).then(function(values) {
										getLatestQuote(values.ticker, values.type).then(function(quotes) {
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
			
			_pool.getConnection(function(err, connection) {
				if (!err) {					
					console.log("Hämtar från trålen.", watchType);
					connection.query('SELECT * FROM trawl WHERE type=?', watchType, function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
								
								for (var i = 0; i < rows.length; i++) {
									console.log("Hämtar uppgifter för", rows[i].ticker);
									getSMAs(rows[i].ticker, "", rows[i].id).then(function(values) {
										getLatestQuote(values.ticker).then(function(quotes) {

											values.quote = quotes.quote;
											values.previousClose = quotes.previousClose;
											values.namn = quotes.company;
											
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
								/* FUnkar inte då symbol bara kan vara en ticker, symbols saknas ännu...
								var tickerCheckList = [];
								
								for (var i = 0; i < rows.length; i++) {
									tickerCheckList[i] = rows[i].ticker;	
								};					

								
								getYahooSnapshot({symbols:tickerCheckList, modules: ['price', 'summaryDetail']}).then(function(snapshot) {
									var percentage;
									
									for (var i = 0; i < Object.keys(snapshot).length; i++) {
										rows[i].senaste = snapshot[i].price.regularMarketPrice;
										rows[i].sma50 = snapshot[i].summaryDetail.fiftyDayAverage;
										rows[i].sma200 = snapshot[i].summaryDetail.twoHundredDayAverage;
										// Beräkna % med 2 decimaler
										percentage = (1 - (rows[i].kurs/snapshot[i].price.regularMarketPrice)) * 100;
										rows[i].utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
										rows[i].atrStoploss = (rows[i].ATR * rows[i].ATRMultipel) / snapshot[i].price.previousClose;
										console.log("ATR=", rows[i].ATR, " ATR multipel=", rows[i].ATRMultipel, " Previous close=", snapshot[i].price.previousClose);
									}
									response.status(200).json(rows);							
								})								
								*/
								
								var tickCounter = 0;
								
								for (var i = 0; i < rows.length; i++) {
									
									getYahooSnapshot({symbol:rows[i].ticker, modules: ['price', 'summaryDetail']}).then(function(snapshot) {
										var percentage;
										var rowPointer;
										
										for (var j = 0; j < rows.length; j++) {
											if (rows[j].namn == snapshot.price.symbol) {
												rowPointer = j;
												break;
											}											
										}										

										console.log(snapshot.price.symbol, rows[rowPointer].namn);
										
										rows[rowPointer].senaste = snapshot.price.regularMarketPrice;
										rows[rowPointer].sma50 = snapshot.summaryDetail.fiftyDayAverage;
										rows[rowPointer].sma200 = snapshot.summaryDetail.twoHundredDayAverage;
										// Beräkna % med 2 decimaler
										percentage = (1 - (rows[rowPointer].kurs/snapshot.price.regularMarketPrice)) * 100;
										rows[rowPointer].utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
										rows[rowPointer].atrStoploss = (rows[rowPointer].ATR * rows[rowPointer].ATRMultipel) / snapshot.price.regularMarketPreviousClose;
										console.log("ATR=", rows[rowPointer].ATR, " ATR multipel=", rows[rowPointer].ATRMultipel, " Previous close=", snapshot.price.regularMarketPreviousClose);
										
										tickCounter++;
										
										console.log();
										
										if (tickCounter == rows.length) {
											console.log("Rows=", rows);
											response.status(200).json(rows);																	
										}
										
									})									
									
								};								
								
								
/*								
								
																		
								yahooFinance.snapshot({
								  symbols: tickerCheckList,
								  modules: ['price', 'summaryDetail']
								}, function (err, snapshot) {
									if (err) {
										console.log(err);	
										response.status(404).json({error:err});						
									}
									else {
										var percentage;
										
										for (var i = 0; i < Object.keys(snapshot).length; i++) {
											rows[i].senaste = snapshot[i].price.regularMarketPrice;
											rows[i].sma50 = snapshot[i].summaryDetail.fiftyDayAverage;
											rows[i].sma200 = snapshot[i].summaryDetail.twoHundredDayAverage;
											// Beräkna % med 2 decimaler
											percentage = (1 - (rows[i].kurs/snapshot[i].price.regularMarketPrice)) * 100;
											rows[i].utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
											rows[i].atrStoploss = (rows[i].ATR * rows[i].ATRMultipel) / snapshot[i].price.previousClose;
											console.log("ATR=", rows[i].ATR, " ATR multipel=", rows[i].ATRMultipel, " Previous close=", snapshot[i].price.previousClose);
										}
										response.status(200).json(rows);							
									}
								});
								
								*/
								
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
