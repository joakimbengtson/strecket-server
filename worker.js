
var config = require('./config.js');
var tokens = require('./tokens.js');


var Worker = module.exports = function(pool, poolMunch) {
	var _this = this;
	var gLastDate;
	
	function debug() {
		if (true)
			console.log.apply(null, arguments);
	};
	
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

	// Gör om en mysql-fråga till en promise för att slippa callbacks/results/errors
	function runQuery(connection, sql, options) {

		return new Promise(function(resolve, reject) {
			var query = connection.query(sql, options, function(error, result) {
				if (error)
					reject(error);
				else
					resolve(result);
			});

			// Skriver ut frågan helt enkelt i klartext
			debug("Query: ", query.sql);
 
		});

	}

	// Kör en vektor med promises sekventiellt och returnerar resolve() när allt är klart.
	// Detta tycker jag borde finnas inbyggt i "native" Promises men jag har inte hittat
	// ett sätt. Det finns i Bluebird-implementationen, men tydligen inte i vanlig JavaScript :(
	function runPromises(promises) {

		return new Promise(function(resolve, reject) {
			var tmp = Promise.resolve();

			promises.forEach(function(promise) {
				tmp = tmp.then(function() {
					return promise();
				});
			});

			tmp.then(function() {
				resolve();
			})
			.catch(function(error) {
				reject(error);
			});

		});

	}
	
	// Skickar sms till jbn
	function sendSMS(txtMsg) {
		return new Promise(function(resolve, reject) {
			
			console.log("Laddar Twilio:", tokens.TWILIO_ACCOUNT_SID, tokens.TWILIO_AUTH_TOKEN);

			var client = require('twilio')(tokens.TWILIO_ACCOUNT_SID, tokens.TWILIO_AUTH_TOKEN);			 

			client.messages
			  .create({
			     body: txtMsg,
			     from: '+46769447443',
			     to: '+46703489493'
			   })

			  .then(function(message) {
				console.log("SMS--->", message.sid, message.body);
				
			  	pool.getConnection(function(err, connection) {	
					if (!err) {
						var rec = {};
						
						rec.text = message.body;
						rec.tid = new Date();

						connection.query('INSERT INTO larm SET ?', rec, function(err, result) {
							if (err)
								console.log("sendSMS: Kunde inte anropa query: ", err);
	
							connection.release();
						});
					}
					else {
						console.log("sendSMS: Kunde inte skapa en connection: ", err);
					}
				});				  
				  
				resolve();
			  })
			  .catch(function(error) {
				  console.log("FEL sendSMS:", error);
				  reject(error);
			  })
			  .done(function() {
				  // ??? JBN
			  });

		});		
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
	

	// Hämtar ett snapshot för en aktie från Yahoo (snapshot blir som parameter i .then())
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
	
	
	// Hämtar alla aktier (returneras i samma format som i databasen)
	function getStocks(connection) {
		return new Promise(function(resolve, reject) {
			runQuery(connection, 'SELECT * FROM aktier').then(function(rows) {
				resolve(rows);
			})
			.catch(function(error) {
				reject(error);
			});
		});
	};


	// Sparar spikes, dvs aktier som uppfyller våra kriterier
	function saveSpikes() {
		
		pool.getConnection(function(error, connection) {
			if (!error) {
		
				poolMunch.getConnection(function(error, munchConnection) {
					if (!error) {
						
						runQuery(munchConnection, 'select distinct date from (SELECT COUNT(date) as c, date FROM stockquotes GROUP BY date HAVING c > 1000) tradeDays order by date desc limit 2').then(function(dates) {
							if (dates.length > 0) {

								var date1 = getFormattedDate(dates[0].date);
								var date2 = getFormattedDate(dates[1].date);
						
								// 60% över normal volym, stängt över gårdagen, över 51 week high, över sma200, omsatt mer än 5 miljoner $ och inte 'Biotech'";
								runQuery(munchConnection, 'SELECT a.symbol, a.volume, b.volume, a.close as lastClose, b.close as previousClose, a.ATR14 FROM stockquotes a INNER JOIN stockquotes b ON a.symbol = b.symbol INNER JOIN stocks ON stocks.symbol = a.symbol WHERE a.date = ? AND b.date = ? AND a.volume > b.AV14*1.6 AND a.close > b.close AND a.close > a.SMA200 AND a.close*a.AV14 > 5000000 AND a.close > a.open AND a.close >= stocks.wh51 AND stocks.industry != "Biotechnology"', [date1, date2]).then(function(rows) {
									if (rows.length > 0) {
console.log("rows=", rows, date1);										
										runQuery(connection, "SELECT * FROM spikes WHERE date=?", [date1]).then(function(hits) {
											console.log("hits=", hits, hits.length);
											if (hits.length == 0) {									
												// Vi har inte sparat detta datum
												rows.forEach(function(row) {
													var tstamp = new Date();
													console.log("sparar=", row.symbol);
													connection.query('INSERT INTO spikes SET date=?, ticker=?, timestamp=?, ATR14=?', [date1, row.symbol, tstamp, row.ATR14]);
												}); 									
											}
											else
												console.log("Redan sparat spikes från ", date1);
										})
										.catch(function(error) {
											connection.release();																	
											console.log("Error:saveSpikes:runQuery:connection", error);
										});
										
									}
									else
										console.log("Inga spikes hittade");
									
									// Markera alla som är under SMA200
									console.log("Scheduled job: tag dogs, date=", date1);
									munchConnection.query('UPDATE stocks INNER JOIN stockquotes ON stocks.symbol = stockquotes.symbol SET stocks.dog = TRUE, stocks.dogDate = NOW() WHERE stockquotes.date=? and stockquotes.close < stocks.sma200 and stocks.dog IS NULL', [date1]);
										
								})
								.catch(function(error) {
									munchConnection.release();																	
									console.log("Error:saveSpikes:runQuery:munchConnection", error);
								});
							}
							else
								console.log("Inga datum hittade.");
						})
						.catch(function(error) {
							munchConnection.release();																	
							console.log("Error:saveSpikes:runQuery:munchConnection:dates", error);
						});
								
					}
					else {
						console.log("Kunde inte skapa en connection till munch: ", error);
					}
				});	
			}	
			else {
				console.log("Kunde inte skapa en connection till strecket: ", error);
			}
		});										
	};

	
	function calculateATRandSMA() {
		var stocksCount = 0;
		
		console.log("----- Hämtar ATR och SMA från Munch för alla aktier");
		
		pool.getConnection(function(error, connection) {
			if (!error) {
				
				poolMunch.getConnection(function(error, munchConnection) {
					if (!error) {

						// Hämta hela aktie-tabellen
						getStocks(connection).then(function(stocks) {
		
							stocks.forEach(function(stock) {
								runQuery(munchConnection, 'SELECT ATR14, SMA20 FROM stocks WHERE symbol=?', [stock.ticker]).then(function(rows) {
									if (rows.length > 0) {

										console.log("Ny ATR för ", stock.ticker, "är", rows[0].ATR14, "föregående ATR", stock.ATR);
										console.log("Ny SMA20 för ", stock.ticker, "är", rows[0].SMA20, "föregående SMA20", stock.SMA20);
										
										connection.query('UPDATE aktier SET ATR=?, SMA20=? WHERE id=?', [rows[0].ATR14, rows[0].SMA20, stock.id]);
									}
									else {
										console.log(stock.ticker, "finns inte i Munch/stocks. Försöker lägga till", stock.ticker);
										munchConnection.query('INSERT INTO stocks(symbol) VALUES(?)', [stock.ticker]);
									}
																										
									++stocksCount;
																				
									if (stocksCount == stocks.length) {
										console.log("----- Klar ATR");		
										connection.release();
										munchConnection.release();								
									}											
								})
								.catch(function(error) {
									connection.release();
									munchConnection.release();																	
									console.log("Error:calculateATRandSMA:runQuery:", error);
								});
							}); 
		
						})
						.catch(function(error) {
							connection.release();							
							munchConnection.release();																	
							console.log("Error:calculateATRandSMA:getStocks:", error);
						});
											
					}
					else {
						console.log("Kunde inte skapa en connection: ", error);
					}
				});		
			}	
			else {
				console.log("Kunde inte skapa en connection: ", error);
			}
			
		});		
						
	};

// NEW do some work

	// Anropas för varje aktie i doSomeWork()
	function doSomeWorkOnStock(connection, stock) {

		return new Promise(function(resolve, reject) {
			getYahooSnapshot({symbol:stock.ticker, modules: ['price']}).then(function(snapshot) { // Hämta senaste kurs och previousClose

				// Nuvarande utfall mot köpkurs
				var percentage = ((snapshot.price.regularMarketPrice/stock.kurs)-1) * 100;
				percentage = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
				
				debug(stock.namn, "utfall %:", percentage, "köpkurs:", stock.kurs, "kurs nu:", snapshot.price.regularMarketPrice, "maxkurs:", stock.maxkurs);

				// En vektor med det som ska göras för varje aktie
				var promises = [];				
				var stopLossQuote;
				
				// Räkna ut stop loss som en fast kurs (som vi inte får gå under)
				switch (stock.stoplossTyp) {
					
					case config.stoplossType.StoplossTypePercent:
						stopLossQuote = (stock.maxkurs - (stock.maxkurs * stock.stoplossProcent)).toFixed(2);						
						break;

					case config.stoplossType.StoplossTypeATR:
						stopLossQuote = (stock.maxkurs - (stock.ATR * stock.ATRMultipel)).toFixed(2);
						break;
						
					case config.stoplossType.StoplossTypeQuote:
						stopLossQuote = stock.stoplossKurs;
						break;					

					case config.stoplossType.StoplossTypeSMA20:
						stopLossQuote = stock.SMA20;
						break;					

					case config.stoplossType.StoplossTypeSMA50:
						stopLossQuote = stock.SMA50;
						break;					
						
					default:
						console.log("Fel: okänd typ av stop loss = ", stock.stoplossType);
				} 
								
				debug(stock.namn, "har stop loss", stopLossQuote);
								
				if (!stock.larm) {
					// Kolla stop loss och larma om det behövs, strunta i detta för sålda aktier	
					if (stock.såld == 0) {					
						if (snapshot.price.regularMarketPrice < stopLossQuote) {						
							console.log(stock.namn, " under stoploss (", snapshot.price.regularMarketPrice, ") -> larma!");
		
							// Larma med sms och uppdatera databasen med larmflagga
							promises.push(sendSMS.bind(_this, stock.namn + " (" + stock.ticker + ")" + " under släpande stoploss (" + percentage + "%)."));
							promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET larm=? WHERE id=?', [1, stock.id]));
						}
					}
				}
				else {
					// Har vi redan larmat, kolla om vi återhämtat oss? (Måste återhämtat minst 1% över stoploss för att räknas...)
					// Kollar ÄVEN sålda aktier om de återhämtat sig
					
					var soldTxt = "";

					if (stock.såld == 1)
						soldTxt = "REDAN SÅLD: ";
					
					if (snapshot.price.regularMarketPrice > stopLossQuote * 1.01) {
						
						console.log(soldTxt, stock.namn, " har återhämtat sig, återställer larm.");

						// Larma med sms och uppdatera databasen med rensad larmflagga
						promises.push(sendSMS.bind(_this, soldTxt + stock.namn + " (" + stock.ticker + ")" + " har återhämtat sig från stoploss, nu " + percentage + "% från köpkursen."));
						promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET larm=? WHERE id=?', [0, stock.id]));
					}
				}									


				// Ny maxkurs?
				if (snapshot.price.regularMarketPrice > stock.maxkurs || stock.maxkurs == null || stock.maxkurs == 0) {
					console.log("Sätter ny maxkurs: ", snapshot.price.regularMarketPrice, stock.ticker);
					promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET maxkurs=? WHERE id=?', [snapshot.price.regularMarketPrice, stock.id]));
				}
								
				debug("------------------------------------------------------------------------------------------------------");


				// Kör alla promises som ligger i kö sekventiellt
				runPromises(promises).then(function() {
					resolve();
				})
				.catch(function(error) {
					// Om något misslyckas, gör så att denna metod också misslyckas
					reject(error);
				});
			})
			.catch(function(error) {
				console.log("ERROR: getYahooSnapshot misslyckades", error);
				resolve();
			});
			
		});

	}


	function doSomeWork() {

		console.log("----- Kollar stop loss på alla aktier");	 	

		return new Promise(function(resolve, reject) {
			
			pool.getConnection(function(error, connection) {

				if (!error) {

					debug("Sekunder mellan koll", config.checkIntervalInSeconds);
	
					// Hämta hela aktie-tabellen
					getStocks(connection).then(function(stocks) {
	
						// Vektorn med jobb som ska utföras
						var promises = [];
	
						// Lägg till ett jobb för varje aktie...
						stocks.forEach(function(stock) {
							// Att anropa xxx.bind() gör att parametrar automatiskt skickas till funktionen när
							// den anropas även utan parametrar (null i detta fall är värdet av 'this')
							promises.push(doSomeWorkOnStock.bind(_this, connection, stock));
						}); 
	
						// runPromises() kör alla promises sekventiellt, antingen lyckas alla eller så blir det ett fel
						runPromises(promises).then(function() {
							connection.release();
							resolve();
						})
						.catch(function(error) {
							connection.release();
							reject(error);
						});
	
					})
					.catch(function(error) {
						connection.release();							
						reject(error);
					});
										
				}
				else {
					console.log("Kunde inte skapa en connection: ", error);
					reject(error);					
				}
				
			});

		});
	};

	function work() {
		
		doSomeWork().then(function() {
			
			setTimeout(work, config.checkIntervalInSeconds * 1000);			

		})

		.catch(function(error) {
			// Om något blev fel, överhuvudtaget (!), så skriv ut hela stacken till konsollen,
			// med radnummer och allt...
			console.log("Fel: ", error);

			// Och börja om igen
			setTimeout(work, config.checkIntervalInSeconds * 1000);
		});

	};

	function init() {
		var schedule = require('node-schedule');
		
		var rule = new schedule.RecurrenceRule();
		rule.hour = 14;
		rule.minute = 0;
				 
		schedule.scheduleJob(rule, function() {
			console.log("Scheduled job: +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++");						
			console.log("Scheduled job: calculate ATR and SMA");			
			calculateATRandSMA();
			console.log("Scheduled job: save spikes");
			saveSpikes();
		});		
		
	};


	this.run = function() {
		console.log("Strecket Server startar!");
		//sendSMS("Strecket Server startar!")
		work();
		saveSpikes();
	};

	init();
};
