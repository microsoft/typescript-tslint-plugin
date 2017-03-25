(function() {
  var request = require('request');
  var prompt = require('prompt');
  var moduleVersion = require("../package.json").version;
  var moduleName = require("../package.json").name;
  var schema = {
    properties: {
      "git username": {required: true},
      "git password": {hidden: true, required: true},
    }
  };
  prompt.start();
  prompt.get(schema, function (err, result) {
    if(err) {
      console.log(err);
      return;
    }
    var gitUsername = result["git username"];
    var gitPassword = result["git password"];
    var requestOptions = {
      url: "https://api.github.com/repos/" + gitUsername + "/" + moduleName + "/releases",
      headers: {"User-Agent": gitUsername},
      auth: {
        user: gitUsername,
        pass: gitPassword
      },
      json: {
        tag_name: moduleVersion,
        target_commitish: "master",
        name: moduleVersion,
        body: "Version " + moduleVersion
      }
    };
    sendTagRequest(requestOptions);
  });

  function sendTagRequest(requestOptions) {
    request.post(requestOptions, function (error, response, body) {
      if (!error && response.statusCode === 201) {
        console.log("Successfully created tag " + body.name + ".");
      } else {
        logError(error, body);
      }
    });
  }

  function logError(error, body) {
    if(error) {
      console.log("Error sending request: " + error);
      return;
    }
    var errorMessage = body && body.message ? body.message : "";
    var errorCode = body && body.errors && body.errors[0] && body.errors[0].code ? body.errors[0].code : "";
    console.log("Could not create a release tag" +
      (errorMessage ? ": " + errorMessage : "") +
      (errorCode ? ". Error code: " + errorCode : "") +
      ".");
  }
})();