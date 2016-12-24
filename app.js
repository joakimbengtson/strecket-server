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


var _pool  = mySQL.createPool({
	host     : '104.155.92.17',
	user     : 'root',
	password : 'potatismos',
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
	

	function listen() {
		
		app.set('port', (args.port || 3000));
		app.use(bodyParser.urlencoded({ limit: '50mb', extended: false }));
		app.use(bodyParser.json({limit: '50mb'}));
		app.use(cors());
		
		
		// ----------------------------------------------------------------------------------------------------------------------------
		// Kollar om ticker finns, i så fall företagsnamn tillbaks
		app.get('/company/:ticker', function (request, response) {

			var ticker = request.params.ticker;
			getYahooSnapshot({symbol:ticker, fields:['n']}).then(function(snapshot) {
				response.status(200).json(snapshot.name);
			})
			.catch(function(error) {
				response.status(200).json([]);
			});

		})
		

		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar alla aktier med aktuell kurs och utfall i % mot köp
		app.get('/stocks', function (request, response) {
			
			_pool.getConnection(function(err, connection) {
				if (!err) {					
					connection.query('SELECT * FROM aktier WHERE såld=0', function(error, rows, fields) {
						if (!error) {
							if (rows.length > 0) {
								var tickerCheckList = [];
								
								for (var i = 0; i < rows.length; i++) {
									tickerCheckList[i] = rows[i].ticker;	
								};					
																		
								yahooFinance.snapshot({
								  symbols: tickerCheckList,
								  fields: ['l1', 'm3', 'm4']
								}, function (err, snapshot) {
									if (err) {
										console.log(err);	
										response.status(404).json({error:err});						
									}
									else {
										var percentage;
										var stoplossStr;
										
										for (var i = 0; i < Object.keys(snapshot).length; i++) {
											rows[i].senaste = snapshot[i].lastTradePriceOnly;
											rows[i].sma50 = snapshot[i]['50DayMovingAverage'];
											rows[i].sma200 = snapshot[i]['200DayMovingAverage'];
											
											// Beräkna % med 2 decimaler
											percentage = (1 - (rows[i].kurs/snapshot[i].lastTradePriceOnly)) * 100;
											rows[i].utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2); 
										}
																		
										stoplossStr = sprintf('Stop loss: %2d%% Släpande stop loss: %2d%% Frikostig stop loss: %2d%% Frikostig nivå: %2d%%', config.stop_loss*100, config.trailing_stop_loss*100, config.lavish_trailing_stop_loss*100, config.lavish_level*100);
										
										rows.push({namn:stoplossStr, ticker:'xxx'});
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
							connection.query('INSERT INTO aktier SET ?', post, function(err, result) {		
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
