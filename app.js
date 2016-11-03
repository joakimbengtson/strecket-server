var express = require('express')
var app = express()

app.get('/', function (request, result) {
	result.send('Hello World!')
})

app.get('/stocks', function (request, result) {

	var stocks = [];

	stocks.push({symbol:'AAPL', price:200});
	stocks.push({symbol:'TSLA', price:300});

	result.send(JSON.stringify(stocks));
})

app.listen(3000);
