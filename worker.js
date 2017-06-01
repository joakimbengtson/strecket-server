
var config = require('./config.js');
var tokens = require('./tokens.js');


var Worker = module.exports = function(pool, poolMunch) {
	var _this = this;

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

			var client = require('twilio')(tokens.TWILIO_ACCOUNT_SID, tokens.TWILIO_AUTH_TOKEN);			 

			client.sendSms({
				    to: '+46703489493',
				    from:'+46769447443',
				    body: txtMsg
			}, function(error, message) {
			    if (error)
					reject(error);				    
				else
					resolve();
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
	
	
	function calculateATR() {
		var firstQuote;
		var atr;
		var prevClose;
		var start;
		var today = getFormattedDate(new Date());
		var twoWeeksAgoish = getFormattedDate(new Date(+new Date - (1000 * 60 * 60 * 24 * 23))); // Hämta 23 dagar tillbaks för att vara säker på att få 14 börsdagar
		var i;
		var stocksCount = 0;
		
		console.log("----- Räknar ut ATR på alla aktier");		
		
		pool.getConnection(function(error, connection) {

			if (!error) {

				// Hämta hela aktie-tabellen
				getStocks(connection).then(function(stocks) {

					stocks.forEach(function(stock) {
						getYahooHistorical({symbol:stock.ticker, from:twoWeeksAgoish, to:today}).then(function(quotes) {
				
							start = Math.max(quotes.length - 14, 0);
							firstQuote = true;

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
							console.log("Ny ATR för ", stock.ticker, "är", atr, "föregående ATR", stock.ATR);
							
							connection.query('UPDATE aktier SET ATR=? WHERE id=?', [atr, stock.id]);
														
							++stocksCount;
																		
							if (stocksCount == stocks.length) {
								console.log("----- Klar ATR");		
								connection.release();								
							}
											
						})
						.catch(function(error) {
							connection.release();
							console.log("Fel:", error);
						});

					}); 

				})
				.catch(function(error) {
					connection.release();							
					console.log("Fel:", error);
				});
									
			}
			else {
				console.log("Kunde inte skapa en connection: ", error);
			}
			
		});		
						
	};


	// Anropas för varje aktie i doSomeWork()
	function doSomeWorkOnStock(connection, stock) {

		return new Promise(function(resolve, reject) {
			getYahooSnapshot({symbol:stock.ticker, modules: ['price']}).then(function(snapshot) { // Hämta senaste kurs och previousClose

				// Nuvarande utfall mot köpkurs
				var percentage = (1 - (stock.kurs/snapshot.price.regularMarketPrice)) * 100;
				percentage = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
				
				debug(stock.namn, "utfall %, köpkurs, kurs nu:", percentage, stock.kurs, snapshot.price.regularMarketPrice);

				// En vektor med det som ska göras för varje aktie
				var promises = [];				
				var stopLoss;
				
				// Räkna ut stop loss
				if (stock.stoplossTyp == config.stoplossType.StoplossTypePercent) {
					stopLoss = stock.stoplossProcent;		
				}
				else if (stock.stoplossTyp == config.stoplossType.StoplossTypeATR) {
					stopLoss = (stock.ATR * stock.ATRMultipel) / snapshot.price.regularMarketPreviousClose;
				} 
				else { // StoplossTypeQuote
					stopLoss = -1;
				}

				// Om percentil10 så addera utfall/10 till stop loss
				if (stopLoss != -1 && stock.percentil10 && percentage > 10) {
					// Percentage är hela procent, stopLoss är hundradelar...
					stopLoss = stopLoss + (percentage/1000);
				}

				
				debug(stock.namn, "har stop loss", stopLoss);
								
				if (!stock.larm) {
					// Kolla stop loss och larma om det behövs, strunta i detta för sålda aktier	
					if (stock.såld == 0) {					
						if (stopLoss != -1) {						
							if (1 - (snapshot.price.regularMarketPrice / stock.maxkurs) > stopLoss) {
								
								console.log(stock.namn, " under släpande stop loss, larma.", stopLoss);
		
								// Larma med sms och uppdatera databasen med larmflagga
								promises.push(sendSMS.bind(_this, stock.namn + " (" + stock.ticker + ")" + " under släpande stop-loss (" + percentage + "%)."));
								promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET larm=? WHERE id=?', [1, stock.id]));
							}						
						}
						else {
							if (snapshot.price.regularMarketPrice < stock.stoplossKurs) {
								
								console.log(stock.namn, " under fasta stop loss-kursen, larma.", snapshot.price.regularMarketPrice, stock.stoplossKurs);
		
								// Larma med sms och uppdatera databasen med larmflagga
								promises.push(sendSMS.bind(_this, stock.namn + " (" + stock.ticker + ")" + " under kursen (" + stock.stoplossKurs + "). Nu på " + snapshot.price.regularMarketPrice));
								promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET larm=? WHERE id=?', [1, stock.id]));
							}						
							
						}					
					}
				}
				else {
					// Har vi redan larmat, kolla om vi återhämtat oss? (Måste återhämtat minst 1% över stoploss för att räknas...)
					// Kollar ÄVEN sålda aktier om de återhämtat sig
					
					var soldTxt = "";

					if (stock.såld == 1)
						soldTxt = "REDAN SÅLD: ";
					
					if (stopLoss != -1) {
						if ((1 - (snapshot.price.regularMarketPrice / stock.maxkurs)) + 0.01 < stopLoss) {
							
							console.log(soldTxt, stock.namn, " har återhämtat sig, återställer larm.");
	
							// Larma med sms och uppdatera databasen med rensad larmflagga
							promises.push(sendSMS.bind(_this, soldTxt + stock.namn + " (" + stock.ticker + ")" + " har återhämtat sig från stoploss, nu " + percentage + "% från köpkursen."));
							promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET larm=? WHERE id=?', [0, stock.id]));
						}
					}
					else {
						if (snapshot.price.regularMarketPrice > (stock.stoplossKurs * 1.01)) {
							
							console.log(soldTxt, stock.namn, " har återhämtat sig, återställer larm.");
	
							// Larma med sms och uppdatera databasen med rensad larmflagga
							promises.push(sendSMS.bind(_this, soldTxt + stock.namn + " (" + stock.ticker + ")" + " är nu åter över stoploss på fast kurs, nu " + snapshot.price.regularMarketPrice + "."));
							promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET larm=? WHERE id=?', [0, stock.id]));
						}						
					}
				}									

				// Kolla om vi flyger
				if (!stock.flyger && stock.såld == 0) {

					debug(stock.namn, 1 - (stock.kurs / snapshot.price.regularMarketPrice), stopLoss);

					// Flyger vi? I så fall sätt flyger = sant
					// Vi flyger om vi tjänar 5% även om stop loss löses ut...
					
					if (stopLoss != -1) {					
						if (1 - (stock.kurs / snapshot.price.regularMarketPrice) > (stopLoss + 0.05)) {
	
							console.log(stock.namn, "flyger!, meddela och sätt flyger=true");
							
							// Meddela med sms och uppdatera databasen med flyger=1
							promises.push(sendSMS.bind(_this, stock.namn + " (" + stock.ticker + ")" + " flyger!! (" + percentage + "%)."));
							promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET flyger=? WHERE id=?', [1, stock.id]));
						}
					}
					else {
						if (snapshot.price.regularMarketPrice > (stock.kurs * 1.05)) {
	
							console.log(stock.namn, "är 5% över inköp, meddela och sätt flyger=true");
							
							// Meddela med sms och uppdatera databasen med flyger=1
							promises.push(sendSMS.bind(_this, stock.namn + " (" + stock.ticker + ")" + " är 5% över inköpskurs!"));
							promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET flyger=? WHERE id=?', [1, stock.id]));
						}
					}

				}

				debug("Senaste kurs, maxkurs: ", snapshot.price.regularMarketPrice, stock.maxkurs);

				// Ny maxkurs?
				if (snapshot.price.regularMarketPrice > stock.maxkurs || stock.maxkurs == null || stock.maxkurs == 0) {
					console.log("Sätter ny maxkurs: ", snapshot.price.regularMarketPrice, stock.ticker);
					promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET maxkurs=? WHERE id=?', [snapshot.price.regularMarketPrice, stock.id]));
				}
								
				debug("---");

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
				// Om något misslyckas, gör så att denna metod också misslyckas
				reject(error);
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
			//console.log("Fel: ", error.stack);

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
			calculateATR();
		});		
		
	};


	this.run = function() {
		work();
	};

	init();
};
