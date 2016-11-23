#!/usr/bin/env node

var express = require('express');
var app = express();
var cors = require('cors');
var sprintf = require('yow').sprintf;
var bodyParser = require('body-parser');
var redirectLogs = require('yow').redirectLogs;
var prefixLogs = require('yow').prefixLogs;
var MySQL = require('mysql');
var yahooFinance = require('yahoo-finance');

var _stop_loss = 0.05;
var _trailing_stop_loss = 0.07;
var _lavish_trailing_stop_loss = 0.15;

const _checkIntervalInSeconds = 5;

var mysql;

/*
var Worker = function(mysql) {
	
	function alarm(id) {
		var query = mysql.query('UPDATE aktier SET larm=? WHERE id=?', [1, id], function(error, result) {
			if (error)
				console.log(error);
		});																						
	};
	
	
	function doSomeWork() {
		var tickerCheckList = [];
		var err = undefined;
				
		return new Promise(function(resolve, reject) {
			
			mysql.query('SELECT * FROM aktier', function(error, rows, fields) {
				if (error) {
					console.log(error);
					err = error;
				}
				else {
					
					if (rows.length > 0) {
						
						// Bygg array med tickers ['MSFT','GOOG', osv...]
						for (var i = 0; i < rows.length; i++) {
							tickerCheckList[i] = rows[i].ticker;	
						};					
																
						yahooFinance.snapshot({
						  symbols: tickerCheckList,
						  fields: ['l1']
						}, function (error, snapshot) {
							if (error) {
								console.log(error);	
								err = error;
							}
							else {
								// Kolla aktuell kurs på alla aktier i tickerChecklist
								var percentage;
								
								for (var i = 0; i < Object.keys(snapshot).length; i++) {								
	
									percentage = (1 - (rows[i].kurs/snapshot[i].lastTradePriceOnly));
									
									if (rows[i].flyger) {
										
										// Vi flyger, kolla Kursdiff > släpande stop loss?
										if (1 - (snapshot[i].lastTradePriceOnly / rows[i].maxkurs) > _trailing_stop_loss) {
											alarm(rows[i].id);
										}
										
									}
									else {
										
										// Vi flyger inte, kolla Kursdiff > stop loss?
										if (1 - (snapshot[i].lastTradePriceOnly / rows[i].kurs) > _stop_loss) {
											alarm(rows[i].id);
										}
										
										// Flyger vi? I så fall sätt flyger = sant
										if (1 - (rows[i].kurs / snapshot[i].lastTradePriceOnly) > _trailing_stop_loss) {
											var query = mysql.query('UPDATE aktier SET flyger=? WHERE id=?', [1, rows[i].id], function(error, result) {
												if (error) {
													console.log(error);
													err = error;
												}
											});																				
										}
										
									}
									
									// Ny maxkurs?
									if (snapshot[i].lastTradePriceOnly > rows[i].maxkurs) {
										var query = mysql.query('UPDATE aktier SET maxkurs=? WHERE id=?', [snapshot[i].lastTradePriceOnly, rows[i].id], function(error, result) {
											if (error) {
												console.log(error);
												err = error;
											}
										});										
									}								
									
								}
	
							}
						});
					}
				}
			});
			
			// console.log('working');
			
			if (err)
				reject(err);
			else
				resolve();
							
		});
	};

	this.run = function() {
		work();		
	};
	
};*/

var Server = function(args) {

	args = parseArgs();
	
	mysql = MySQL.createConnection({
	  host     : '104.155.92.17',
	  user     : 'root',
	  password : 'potatismos',
	  database : 'strecket'
	});

	mysql.connect();
	/*
	// Get stops
	mysql.query('SELECT * FROM settings LIMIT 1', function(error, rows, fields) {
		if (error) {
			console.log(error);
		}
		else {
			_stop_loss = rows[0].stop_loss;
			_trailing_stop_loss = rows[0].trailing_stop_loss;
			_lavish_trailing_stop_loss = rows[0].lavish_trailing_stop_loss;			
		}
	});
*/
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

	function listen() {
		
		app.set('port', (args.port || 3000));
		app.use(bodyParser.urlencoded({ limit: '50mb', extended: false }))
		app.use(bodyParser.json({limit: '50mb'}));
		app.use(cors());
		

		// ----------------------------------------------------------------------------------------------------------------------------
		// Returnerar alla aktier med aktuell kurs och utfall i % mot köp
		app.get('/stocks', function (request, response) {

			mysql.query('SELECT * FROM aktier', function(error, rows, fields) {
				if (rows.length > 0) {
					if (error) {
						response.status(200).json([]);
					}
					else {
						//console.log(JSON.stringify(rows));
						var tickerCheckList = [];

						
						for (var i = 0; i < rows.length; i++) {
							tickerCheckList[i] = rows[i].ticker;	
						};					
																
						yahooFinance.snapshot({
						  symbols: tickerCheckList,
						  fields: ['l1']
						}, function (err, snapshot) {
							if (err) {
								console.log(err);	
								response.status(404).json({error:err});						
							}
							else {
								var percentage;
								
								for (var i = 0; i < Object.keys(snapshot).length; i++) {
									rows[i].senaste = snapshot[i].lastTradePriceOnly;
									
									// Beräkna % med 2 decimaler
									percentage = (1 - (rows[i].kurs/snapshot[i].lastTradePriceOnly)) * 100;
									rows[i].utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2);
								}
								response.status(200).json(rows);							
							}
						});
					}	
				}
				else
					response.status(200).json([]);
			});
		})
		

		// ----------------------------------------------------------------------------------------------------------------------------
		// Sparar ny aktie
		app.post('/save', function (request, response) {

			var post  = request.body;

			var query = mysql.query('INSERT INTO aktier SET ?', post, function(err, result) {

				if (err)
					response.status(404).json({error:err});
				else
					response.status(200).json({status:result});
			});	
		})


		// ----------------------------------------------------------------------------------------------------------------------------
		// Raderar aktie
		app.delete('/stocks/:id', function (request, response) {

			var id  = request.params.id;

			console.log('id', id);
			
			var query = mysql.query('DELETE FROM aktier WHERE id=?', id, function(err, result) {

				if (err)
					response.status(404).json({error:err});
				else
					response.status(200).json({status:result});
			});	
		})


		app.listen(app.get('port'), function() {
			console.log("Node app is running on port " + app.get('port'));
		});

	};


	function work() {
		var Worker = require('./worker.js');
		var worker = new Worker(mysql);
		worker.run();
	};	
	
	
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
