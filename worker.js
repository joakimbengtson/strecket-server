

var Worker = module.exports = function() {

	var _this = this;
	var _mysql = undefined;

	// Dina variabler
	var _checkIntervalInSeconds = 5;
	var _stop_loss = 0.05;
	var _trailing_stop_loss = 0.07;
	var _lavish_trailing_stop_loss = 0.15;

	function debug() {
		console.log.apply(null, arguments);
	};

	// Gör om en mysql-fråga till en promise för att slippa callbacks/results/errors
	function runQuery(sql, options) {

		return new Promise(function(resolve, reject) {
			var query = _mysql.query(sql, options, function(error, result) {
				if (error)
					reject(error);
				else
					resolve(result);
			});

			// Skriver ut frågan helt enkelt i klartext
			debug(query.sql);

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

	// Hämtar ett snapshot för en aktie från Yahoo (snapshot blir som parameter i .then())
	function getYahooSnapshot(options) {

		return new Promise(function(resolve, reject) {

			var yahoo = require('yahoo-finance');

			yahoo.snapshot(options, function (error, snapshot) {
				if (error)
					reject(error);
				else
					resolve(snapshot);
			});
		});
	};


	// Hämtar inställningar
	function getSettings() {

		return new Promise(function(resolve, reject) {
			runQuery('SELECT * FROM settings LIMIT 1').then(function(rows) {
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
	function getStocks() {
		return new Promise(function(resolve, reject) {
			runQuery('SELECT * FROM aktier').then(function(rows) {
				resolve(rows);
			})
			.catch(function(error) {
				reject(error);
			});
		});
	};

	// Anropas för varje aktie i doSomeWork()
	function doSomeWorkOnStock(stock) {

		return new Promise(function(resolve, reject) {
			getYahooSnapshot({symbol:stock.ticker, fields:['l1']}).then(function(snapshot) {

				// Här kommer din algoritm med i bilden...

				var percentage = (1 - (stock.kurs/snapshot.lastTradePriceOnly));

				// En vektor med det som ska göras för varje aktie
				var promises = [];

				if (stock.flyger) {

					// Vi flyger, kolla Kursdiff > släpande stop loss?
					if (1 - (snapshot.lastTradePriceOnly / stock.maxkurs) > _trailing_stop_loss) {
						// Lägg till ett 'alarm' i kön, att anropa .bind() lägger ju till parametrar vid anropet
						// Och vektor.push() adderar ett element på slutet av vektorn.
						promises.push(runQuery.bind(_this, 'UPDATE aktier SET larm=? WHERE id=?', [1, stock.id]));
					}

				}
				else {

					// Vi flyger inte, kolla Kursdiff > stop loss?
					if (1 - (snapshot.lastTradePriceOnly / stock.kurs) > _stop_loss) {
						// Lägg till en query till...
						promises.push(runQuery.bind(_this, 'UPDATE aktier SET larm=? WHERE id=?', [1, stock.id]));
					}

					// Flyger vi? I så fall sätt flyger = sant
					if (1 - (stock.kurs / snapshot.lastTradePriceOnly) > _trailing_stop_loss) {
						// Och en till...
						promises.push(runQuery.bind(_this, 'UPDATE aktier SET flyger=? WHERE id=?', [1, stock.id]));
					}

				}

				// Ny maxkurs?
				if (snapshot.lastTradePriceOnly > stock.maxkurs) {
					// Ytterligare en!
					promises.push(runQuery.bind(_this, 'UPDATE aktier SET maxkurs=? WHERE id=?', [snapshot.lastTradePriceOnly, stock.id]));
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

			// Hämta inställningar, börja sedan med jobbet
			// Visst, ett extra anrop, men du kan ändra det i Sequel Pro
			// när som helst och värdena slår igenom...
			getSettings().then(function(settings) {

				// Spara resultatet som kom tillbaka från inställningarna
				_stop_loss = settings._stop_loss;
				_trailing_stop_loss = settings._trailing_stop_loss;
				_lavish_trailing_stop_loss = settings._lavish_trailing_stop_loss;

				// Hämta hela aktie-tabellen
				// Visst, ett anrop till...
				getStocks().then(function(stocks) {

					// Vektorn med jobb som ska utföras
					var promises = [];

					// Lägg till ett jobb för varje aktie...
					stocks.forEach(function(stock) {
						// Att anropa xxx.bind() gör att parametrar automatiskt skickas till funktionen när
						// den anropas även utan parametrar (null i detta fall är värdet av 'this')
						promises.push(doSomeWorkOnStock.bind(_this, stock));
					});

					// runPromises() kör alla promises sekventiellt, antingen lyckas alla eller så blir det ett fel
					runPromises(promises).then(function() {
						resolve();
					})
					.catch(function(error) {
						// Blir det något fel någonstans, hamnar vi här
						reject(error);
					});

				});
			})

			.catch(function(error) {
				reject(error);
			});


		});
	};

	function work() {

		doSomeWork().then(function() {
			setTimeout(work, _checkIntervalInSeconds * 1000);
		})

		.catch(function(error) {
			// Om något blev fel, över huvudtaget (!), så skriv ut hela stacken till konsollen,
			// med radnummer och allt...
			debug(error.stack);

			// Och börja om igen
			setTimeout(work, _checkIntervalInSeconds * 1000);
		});

	};

	function init() {
		var MySQL = require('mysql');

		_mysql = MySQL.createConnection({
		  host     : '104.155.92.17',
		  user     : 'root',
		  password : 'potatismos',
		  database : 'strecket'
		});

		_mysql.connect();

	};


	this.run = function() {
		work();
	};

	init();
};
