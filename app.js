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


var mysql;


var Server = function(args) {

	args = parseArgs();
	
	mysql = MySQL.createConnection({
	  host     : '104.155.92.17',
	  user     : 'root',
	  password : 'potatismos',
	  database : 'strecket'
	});

	mysql.connect();

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
		app.use(bodyParser.urlencoded({ limit: '50mb', extended: false }));
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
								var stoplossStr;
								
								for (var i = 0; i < Object.keys(snapshot).length; i++) {
									rows[i].senaste = snapshot[i].lastTradePriceOnly;
									
									// Beräkna % med 2 decimaler
									percentage = (1 - (rows[i].kurs/snapshot[i].lastTradePriceOnly)) * 100;
									rows[i].utfall = parseFloat(Math.round(percentage * 100) / 100).toFixed(2); 
								}
								var a,b,c,d;
								stoplossStr = "Stop loss: " + a + " Släpande stop loss: " + b + " Frikostig stop loss: " + c + " Frikostig nivå: " + d;
								
								rows.push({namn:stoplossStr, ticker:'xxx'});
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

			console.log('Raderar id: ', id);
			
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
