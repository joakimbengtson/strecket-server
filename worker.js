
var config = require('./config.js');

var Worker = module.exports = function(pool) {
	var _this = this;

	function debug() {
		if (false)
			console.log.apply(null, arguments);
	};

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

			var client = require('twilio')(
				process.env.TWILIO_ACCOUNT_SID,
				process.env.TWILIO_AUTH_TOKEN
			);			 

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

	// Hämtar ett snapshot för en aktie från Yahoo (snapshot blir som parameter i .then())
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
	
	
	// Hämtar inställningar
	function getSettings(connection) {

		return new Promise(function(resolve, reject) {
			runQuery(connection, 'SELECT * FROM settings LIMIT 1').then(function(rows) {
				
				// Returnera svaret, det kommer att bli i formen
				// {id:xxx, stop_loss:xxx, trailing_stop_loss:xxx, lavish_trailing_stop_loss: xxx}
				resolve(rows[0]);
			})
			.catch(function(error) {
				reject(error);
			});
		});
	};


	// Hämtar alla aktier (returneras i samma format som i databasen)
	function getStocks(connection) {
		return new Promise(function(resolve, reject) {
			runQuery(connection, 'SELECT * FROM aktier WHERE såld=0').then(function(rows) {
				resolve(rows);
			})
			.catch(function(error) {
				reject(error);
			});
		});
	};


	// Anropas för varje aktie i doSomeWork()
	function doSomeWorkOnStock(connection, stock) {

		return new Promise(function(resolve, reject) {
			getYahooSnapshot({symbol:stock.ticker, fields:['l1']}).then(function(snapshot) {

				// Nuvarande utfall mot köpkurs
				var percentage = (1 - (stock.kurs/snapshot.lastTradePriceOnly)) * 100;
				percentage = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
				
				debug(stock.namn, percentage, stock.kurs, snapshot.lastTradePriceOnly);

				// En vektor med det som ska göras för varje aktie
				var promises = [];

				// Om vi flyger kollar vi nuvarande kurs mot släpande stop loss
				if (stock.flyger) {
					
					debug(stock.namn, "flyger");
					
					if (!stock.larm) {
						// Om vi inte redan larmat, kolla om vi ska larma
						var stopLoss = config.trailing_stop_loss;
						
						if (stock.stoploss) {
							debug(stock.namn, "har egen stop loss", stock.stoploss)
							stopLoss = stock.stoploss;							
						}
						else
							debug(stock.namn, "default stop loss", stopLoss)

						if (1 - (snapshot.lastTradePriceOnly / stock.maxkurs) > stopLoss) {
							
							console.log(stock.namn, " under släpande stop loss, larma");
	
							// Larma med sms och uppdatera databasen med larmflagga
							promises.push(sendSMS.bind(_this, stock.namn + " (" + stock.ticker + ")" + " under släpande stop-loss (" + percentage + "%)."));
							promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET larm=? WHERE id=?', [1, stock.id]));
						}						
						
					}
					
					/*
					// Vi flyger, kolla Kursdiff > släpande stop loss?
					if (!stock.larm && 1 - (snapshot.lastTradePriceOnly / stock.maxkurs) > config.trailing_stop_loss) {
						
						console.log(stock.namn, " under släpande stop loss, larma");

						// Larma med sms och uppdatera databasen med larmflagga
						promises.push(sendSMS.bind(_this, stock.namn + " (" + stock.ticker + ")" + " under släpande stop-loss (" + percentage + "%)."));
						promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET larm=? WHERE id=?', [1, stock.id]));
					}
					*/

				}
				else {

					debug(stock.namn, "flyger inte");

					// Om vi inte flyger, kolla Kursdiff > stop loss?
					if (!stock.larm && 1 - (snapshot.lastTradePriceOnly / stock.kurs) > config.stop_loss) {
						
						console.log(stock.namn, " under stop loss, larma");

						// Larma med sms och uppdatera databasen med larmflagga
						promises.push(sendSMS.bind(_this, stock.namn + " (" + stock.ticker + ")" + " under stop-loss. (" + percentage + "%)."));						
						promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET larm=? WHERE id=?', [1, stock.id]));
					}

					debug(stock.namn, 1 - (stock.kurs / snapshot.lastTradePriceOnly), config.trailing_stop_loss);

					// Flyger vi? I så fall sätt flyger = sant
					if (1 - (stock.kurs / snapshot.lastTradePriceOnly) > config.trailing_stop_loss) {

						console.log(stock.namn, "flyger!, meddela och sätt flyger=true");
						
						// Meddela med sms och uppdatera databasen med flyger=1
						promises.push(sendSMS.bind(_this, stock.namn + " (" + stock.ticker + ")" + " flyger!! (" + percentage + "%)."));
						promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET flyger=? WHERE id=?', [1, stock.id]));
					}

				}

				debug("Senaste pris, max pris: ", snapshot.lastTradePriceOnly, stock.maxkurs);

				// Ny maxkurs?
				if (snapshot.lastTradePriceOnly > stock.maxkurs) {
					console.log("Sätter ny maxkurs: ", snapshot.lastTradePriceOnly, stock.ticker);
					promises.push(runQuery.bind(_this, connection, 'UPDATE aktier SET maxkurs=? WHERE id=?', [snapshot.lastTradePriceOnly, stock.id]));
				}

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


		return new Promise(function(resolve, reject) {
			
			pool.getConnection(function(error, connection) {

				if (!error) {

					// Hämta inställningar, börja sedan med jobbet
					getSettings(connection).then(function(settings) {
		
						// Spara resultatet som kom tillbaka från inställningarna
						config.stop_loss = settings.stop_loss;
						config.trailing_stop_loss = settings.trailing_stop_loss;
						config.lavish_trailing_stop_loss = settings.lavish_trailing_stop_loss;
						config.lavish_level = settings.lavish_level;
						
						debug(config.checkIntervalInSeconds, config.stop_loss, config.trailing_stop_loss, config.lavish_trailing_stop_loss, config.lavish_level);
		
						// Hämta hela aktie-tabellen
						// Visst, ett anrop till...
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
	/*	var MySQL = require('mysql');

		_mysql = MySQL.createConnection({
		  host     : '104.155.92.17',
		  user     : 'root',
		  password : 'potatismos',
		  database : 'strecket'
		});

		_mysql.connect();*/

	};


	this.run = function() {
		work();
	};

	init();
};
