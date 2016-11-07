#!/usr/bin/env node

var express = require('express');
var app = express();
var cors = require('cors');
var sprintf = require('yow').sprintf;
var bodyParser = require('body-parser');
var redirectLogs = require('yow').redirectLogs;
var prefixLogs = require('yow').prefixLogs;
var MySQL = require('mysql');




var Worker = function() {
	
	
	function doSomeWork() {
		return new Promise(function(resolve, reject) {
			console.log('working');
			var error = undefined;
			if (error)
				reject();
			else
				resolve();
		});
	};
	
	function work() {

		doSomeWork().then(function() {
			
			setTimeout(work, 10000);

						
		})
		.catch(function(error ){
			console.log(error);
			setTimeout(work, 10000);
			
		});						
	};

	this.run = function() {
		work();		
	};
};

var Server = function(args) {

	args = parseArgs();
	
	var mysql = MySQL.createConnection({
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
		app.use(bodyParser.urlencoded({ limit: '50mb', extended: false }))
		app.use(bodyParser.json({limit: '50mb'}));
		app.use(cors());

		app.get('/stocks', function (request, response) {

			mysql.query('SELECT * FROM aktier', function(error, rows, fields) {
			  if (error) {
				  response.status(200).json([]);

			  }
			  else {
				  response.status(200).json(rows);
			  }


			});
		})

		app.get('/', function (request, response) {
			response.send('Hello World!')
		})

		app.post('/save', function (request, response) {

		console.log(request.body);
			var post  = request.body; //JSON.parse(request.body);

			var query = mysql.query('INSERT INTO stocks SET ?', post, function(err, result) {

				if (err)
					response.status(404).json({error:err});
				else
					response.status(200).json({status:result});
			});	
			console.log('sql', query.sql);		
		})

		app.listen(app.get('port'), function() {
			console.log("Node app is running on port " + app.get('port'));
		});


	}

	function work() {
		var worker = new Worker();
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
