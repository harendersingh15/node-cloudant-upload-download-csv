"use strict";
const express = require('express');
const path = require("path");
const bodyParser = require('body-parser');
const http = require('http');
const fs = require('fs');
const babyParse = require('babyparse');
const cfenv = require('cfenv');
const app = express();

const methodOverride = require('method-override');
const logger = require('morgan');
const errorHandler = require('errorhandler');
const multipart = require('connect-multiparty')
const multipartMiddleware = multipart();
const multer = require('multer');

app.use(methodOverride());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));

app.use(express.static(path.join(__dirname, '/public')));
var appEnv = cfenv.getAppEnv();

//////////multer middleware to updload file////////////////
var storageCSV = multer.diskStorage({
    destination: function(req, file, callback) {
        callback(null, './uploads');
    },
    filename: function(req, file, callback) {
        callback(null, file.originalname);
    }
});
var uploadCSV = multer({ storage: storageCSV }).single('file');

////////////////--------------Clodant DB connection----------------/////////////////

let db;
let cloudant;
let fileToUpload;
let dbCredentials = {
    dbName: 'my_sample_db'
};


function getDBCredentialsUrl(jsonData) {
    var vcapServices = JSON.parse(jsonData);
    for (var vcapService in vcapServices) {
        if (vcapService.match(/cloudant/i)) {
            return vcapServices[vcapService][0].credentials.url;
        }
    }
}

function initDBConnection() {
    if (process.env.VCAP_SERVICES) {
        dbCredentials.url = getDBCredentialsUrl(process.env.VCAP_SERVICES);
    } else {

        dbCredentials.url = getDBCredentialsUrl(fs.readFileSync("vcap-local.json", "utf-8"));
    }


    cloudant = require('cloudant')(dbCredentials.url);

    // check if DB exists if not create
    cloudant.db.create(dbCredentials.dbName, function(err, res) {
        if (err) {
            console.log('Could not create new db: ' + dbCredentials.dbName + ', it might already exist.');
        }
    });

    db = cloudant.use(dbCredentials.dbName);
}

initDBConnection();


/////////-----------------API-----------------//////////////

// api to save single emp via postman or from form-post
app.post('/api/employee', (request, response) => {
    let data = request.body.data || request.body;
    let emp = {
        'name': data.name,
        'age': data.age,
        'mobile': data.mobile || '9999999999',
        'occupation': data.occupation
    };

    db.insert(emp, (err, doc) => {
        if (err) {
            response.status(500).send('some thing happen wrong!!!');
        } else {
            db.get(doc.id, (err, data) => {
                if (err) {
                    response.send(err);
                } else {
                    response.send(data);
                }
            });
        }
    });
});

//api to download the csv file
app.get('/downloadEmployeeCSV', (req, res) => {
    let data = [];
    db.list({ include_docs: true }, (err, result) => {
        if (err) {
            res.send('Something happend wrong!!!');
        } else {
            result.rows.forEach((item) => {
                let rowData = {
                    'name': item.doc.name,
                    'occupation': item.doc.occupation
                }

                data.push(rowData);
            });

            let filterData = data.filter((item) => { if (item.occupation) { return item; } });


            let content = babyParse.unparse(filterData);

            res.setHeader("Content-disposition", "attachment; filename=testing.csv");
            res.writeHead(200, {
                "Content-Type": "text/csv"
            });

            res.end(content, "utf-8");
        }
    });
});

// upload CSV file
app.post("/uploadCSV", (req, res, next) => {

    uploadCSV(req, res, (err) => {
        if (err) {
            return res.end("Error uploading file." + err);
        }

        let csvFileName = req.file.originalname; // csvFile.path;

        // read from file
        let content = fs.readFileSync('uploads/' + csvFileName, { encoding: "binary" });
        let csvData = babyParse.parse(content, { header: true, skipEmptyLines: true });

        db.bulk({ "docs": csvData.data }, (err, doc) => {
            if (err) {
                return res.status(500).send('some thing happen wrong!!!');
            } else {
                console.log("File is uploaded");
                res.send(doc);
            }
        });
    });
    //  res.send("File is uploaded");
});

//delete a single emp through postman or from UI request
app.delete('/api/employee/:id', (request, response) => {

    let id = request.params.id;

    db.get(id, {
        revs_info: true
    }, (err, doc) => {
        if (!err) {
            db.destroy(doc._id, doc._rev, (err, res) => {
                // Handle response
                if (err) {
                    response.sendStatus(500);
                } else {
                    response.sendStatus(200);
                }
            });
        }
    });
});


//get all the emp list
app.get('/api/employee', (request, response) => {
    var rowData = [];
    db.list({ include_docs: true, query: { 'name': "nitin kumar" } }, (err, result) => {
        if (err) {
            response.send('Something happend wrong!!!');
        } else {
            result.rows.forEach(function(item) {
                rowData.push(item.doc);
            });
            response.send(rowData);
        }
    })
});



// start server on the specified port and binding host
app.listen(appEnv.port, '0.0.0.0', function() {
    // print a message when the server starts listening
    console.log("server starting on " + appEnv.url);
});

// development only
if ('development' == app.get('env')) {
    console.log('in to the development area')
        //app.use(express.static(path.join(__dirname, 'node_modules')));
    app.use(errorHandler());
}