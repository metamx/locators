{ expect } = require("chai")

{simpleLocatorFactory} = require('../build/simple')

describe.only 'Simple locator', ->
  describe 'shortcut function', ->
    locator = simpleLocatorFactory("localhost:8080")

    it "works", (done) ->
      locator((err, location) ->
        expect(err).to.not.exist
        expect(location).to.deep.equal({
          host: 'localhost'
          port: 8080
        })
        done()
      )

  describe 'full option function', ->
    locator = simpleLocatorFactory({
      resource: "localhost;koalastothemax.com:80"
      defaultPort: 8181
    })

    it "works", (done) ->
      locator((err, location) ->
        expect(err).to.not.exist
        for i in [1..20]
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
