{ expect } = require("chai")

{simpleLocator} = require('../build/simple')

describe 'Simple locator', ->
  describe 'shortcut function', ->
    locator = simpleLocator("localhost:8080")

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
    locator = simpleLocator({
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
