var express = require('express')
var app = express()
const port = 3000


var mysql      = require('mysql');
var connection = mysql.createConnection({
  host     : '104.155.92.17',
  user     : 'root',
  password : 'potatismos',
  database : 'strecket'
});

connection.connect();



app.get('/', function (request, result) {
	result.send('Hello World!')
})

app.get('/stocks', function (request, result) {

	connection.query('SELECT * FROM aktier', function(error, rows, fields) {
	  if (error) {
	  	result.send({error:error});

	  }
	  else {
	  	result.send(JSON.stringify(rows));
	  }


	});
})

//app.listen(3000);



app.listen(port, (err) => {
  if (err) {
    return console.log('something bad happened', err)
  }

  console.log(`server is listening on ${port}`)
})
