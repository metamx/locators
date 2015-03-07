{ expect } = require("chai")
nock = require("nock")

{requestLocatorFactory} = require('../build/request')

describe 'Request locator', ->
  scope = null

  afterEach ->
    nock.cleanAll()

  describe 'shortcut function', ->
    it "works", (done) ->
      scope = nock("http://www.test-endpoint.com:8080")
        .get("/list")
        .reply(200, '{"servers": [{"address": "localhost", "port": 8080}]}')

      locator = requestLocatorFactory()
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

      locator = requestLocatorFactory()
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

      locator = requestLocatorFactory()
      requestLocator = locator("http://www.test-endpoint.com:8080/list")

      requestLocator()
        .then((location) ->
          expect(location).not.to.exist
        )
        .catch((err) ->
          expect(err).to.exist
          expect(err.message).to.equal("BAD_RESPONSE")
          done()
        )
        .done()

    it "returns an error when gets network error", (done) ->
      locator = requestLocatorFactory()
      requestLocator = locator("http://www.test-endpoint.com:8080/list")

      requestLocator()
        .then((location) ->
          expect(location).not.to.exist
        )
        .catch((err) ->
          expect(err).to.exist
          expect(err.message).to.equal('Nock: Not allow net connect for \"www.test-endpoint.com:8080\"')
          done()
        )
        .done()