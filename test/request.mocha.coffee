{ expect } = require("chai")
nock = require("nock")

{request} = require('../build/index')

describe 'Request locator', ->
  scope = null

  afterEach ->
    nock.cleanAll()

  describe 'shortcut function', ->
    it "works", (done) ->
      scope = nock("http://www.test-endpoint.com:8080")
        .get("/list")
        .reply(200, '{"servers": [{"address": "localhost", "port": 8080}]}')

      locator = request()
      requestLocator = locator("http://www.test-endpoint.com:8080/list")

      requestLocator()
        .then((location) ->
          expect(location).to.deep.equal({
            host: 'localhost'
            port: 8080
          })
          done()
        )
        .done()

  describe 'full option with custom dataExtractor', ->
    it "works", (done) ->
      scope = nock("http://www.test-endpoint.com:8080")
      .get("/list")
      .reply(200, '{"blah": [{"address": "localhost", "port": 8080}, {"address": "localhost", "port": 1234}]}')

      locator = request()
      requestLocator = locator({
        url: "http://www.test-endpoint.com:8080/list"
        dataExtractor: (data) ->
          location = JSON.parse(data).blah[1]
          return {
            host: location.address
            port: location.port
          }
      })

      requestLocator()
        .then((location) ->
          expect(location).to.deep.equal({
            host: 'localhost'
            port: 1234
          })
          done()
        )
        .done()

  describe 'when encountering errors', ->
    it "returns an error when gets bad response", (done) ->
      scope = nock("http://www.test-endpoint.com:8080")
        .get("/list")
        .reply(404, 'NOT_FOUND')

      locator = request()
      requestLocator = locator("http://www.test-endpoint.com:8080/list")

      requestLocator()
        .then((location) ->
          expect(location).not.to.exist
        )
        .catch((err) ->
          expect(err).to.exist
          expect(err.message).to.equal("bad response")
          done()
        )
        .done()

    it "returns an error when gets network error", (done) ->
      locator = request()
      requestLocator = locator("http://www.test-endpoint.com:8080/list")

      requestLocator()
        .then((location) ->
          expect(location).not.to.exist
        )
        .catch((err) ->
          expect(err).to.exist
          expect(err.message).to.equal('getaddrinfo ENOTFOUND www.test-endpoint.com www.test-endpoint.com:8080')
          done()
        )
        .done()