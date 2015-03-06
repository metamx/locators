{ expect } = require("chai")

{simpleLocatorFactory} = require('../build/simple')

describe 'Simple locator', ->
  describe 'shortcut function', ->
    locator = simpleLocatorFactory()
    simpleLocator = locator("localhost:8080")

    it "works", (done) ->
      simpleLocator()
        .then((location) ->
          expect(location).to.deep.equal({
            host: 'localhost'
            port: 8080
          })
          done()
        )
        .done()

  describe 'full option function', ->
    locator = simpleLocatorFactory()
    simpleLocator = locator({
      resource: "localhost;koalastothemax.com:80"
      defaultPort: 8181
    })

    it "works", (done) ->
      simpleLocator()
        .then((location) ->
          if location.host is 'localhost'
            expect(location).to.deep.equal({
              host: 'localhost'
              port: 8181
            })
          else
            expect(location).to.deep.equal({
              host: 'koalastothemax.com'
              port: 80
            })
          done()
        )
        .done()
