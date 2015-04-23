{ expect } = require("chai")

exec = require('child_process').exec
Promise = require('q')
async = require('async') # TODO remove async
zookeeper = require('node-zookeeper-client')
{CreateMode} = zookeeper

{ simpleLocatorFactory } = require('../build/simple')
{ zookeeperLocatorFactory } = require('../build/zookeeper')
LocatorException = require('../build/locatorException')

zkClient = zookeeper.createClient(
  'localhost:2181',
  {
    sessionTimeout: 10000
    spinDelay: 1000
    retries: 0
  }
)

rmStar = (path, callback) ->
  zkClient.getChildren(path, (err, children) ->
    if err
      if err.getCode() is zookeeper.Exception.NO_NODE
        callback(null)
      else
        callback(err)
      return

    async.map(
      children
      (child, callback) -> zkClient.remove(path + '/' + child, callback)
      (err) -> callback(err)
    )
    return
  )

createNode = (node, guid, obj, callback) ->
  zkClient.mkdirp(
    "/discovery/#{node}/#{guid}"
    new Buffer(JSON.stringify(obj))
    (error, path) ->
      if error
        console.log(error.stack)
        callback(error)
        return
      callback()
      return
  )
  return

removeNode = (node, guid, callback) ->
  zkClient.remove("/discovery/#{node}/#{guid}", callback)
  return

zkClient.connect()

getPool = (locator) ->
  locations = []

  deferred = Promise.defer()
  done = false

  action = (location) ->
    location = location.host + ':' + location.port

    if location in locations
      done = true
    else
      locations.push(location)

    getPoolHelper()
    return


  getPoolHelper = ->
    if done
      deferred.resolve(locations.sort())
      return

    locator()
      .then(action)
      .catch((err) ->
        deferred.reject(err)
      )
      .done()

    return

  process.nextTick(getPoolHelper)
  return deferred.promise

simpleExec = (cmd, done) ->
  exec(cmd, (err, stdout, stderr) ->
    if err
      console.log(cmd)
      console.log('  stdout: ' + stdout)
      console.log('  stderr: ' + stderr)
      console.log('  exec err: ' + err)
    done(err)
  )

describe 'Zookeeper locator', ->
  zookeeperLocator = null
  myServiceLocator = null
  lastSeenPool = null

  describe 'when locating non-existent service', ->
    @timeout 5000

    beforeEach (done) ->
      async.series([
        (callback) -> simpleExec('zkServer start', callback)
        (callback) -> rmStar('/discovery/my:service', callback)
        (callback) -> zkClient.remove('/discovery/my:service', -> callback())
        (callback) ->
          zookeeperLocator = zookeeperLocatorFactory({
            serverLocator: simpleLocatorFactory()('localhost:2181')
            path: '/discovery'
            timeout: 5000
          })

          zookeeperLocator.on LocatorException.CODE["NEW_POOL"], (path, pool) ->
            expect(path).to.equal('/my:service')
            lastSeenPool = pool
            return

          myServiceLocator = zookeeperLocator('my:service')
          callback()
      ], done)

    afterEach (done) ->
      simpleExec('zkServer stop', done)

    it "fails on non-existent service", (done) ->
      eventSeen = false
      zookeeperLocator.once LocatorException.CODE["PATH_NOT_FOUND"], (path, err) ->
        eventSeen = true
        expect(path).to.equal('/my:service')
        return

      zookeeperLocator('my:service')()
        .then((location) ->
          expect(location).not.to.exist
        )
        .catch((err) ->
          expect(err).to.exist
          expect(err.message).to.equal(LocatorException.CODE["EMPTY_POOL"])
          expect(eventSeen, 'didnt see path_not_found error').to.be.true
          expect(eventSeen).to.be.true
          done()
        )
        .done()


    it "recovers after it fails on non-existent service", (done) ->
      eventSeen = false
      zookeeperLocator.once LocatorException.CODE["PATH_NOT_FOUND"], (path, err) ->
        eventSeen = true
        expect(path).to.equal('/my:service')
        return

      zookeeperLocator('my:service')()
        .then((location) ->
          expect(location).not.to.exist
        )
        .catch((err) ->
          expect(err).to.exist
          expect(err.message).to.equal(LocatorException.CODE["EMPTY_POOL"])
          expect(eventSeen, 'didnt see path_not_found error').to.be.true

          createNode('my:service', 'fake-guid-2-1', { address: '10.10.10.10', port: 8080 }, ->
            zookeeperLocator('my:service')()
              .then((location) ->
                expect(location).to.deep.equal({ host: '10.10.10.10', port: 8080 })
                done()
              )
              .catch((err) ->
                expect(err).not.to.exist
              )
              .done()
          )
        )
        .done()


  describe 'under normal condition', ->
    @timeout 5000

    beforeEach (done) ->
      async.series([
        (callback) -> simpleExec('zkServer start', callback)
        (callback) -> rmStar('/discovery/my:service', callback)
        (callback) -> createNode('my:service', 'fake-guid-1-1', { address: '10.10.10.10', port: 8080 }, callback)
        (callback) -> createNode('my:service', 'fake-guid-1-2', { address: '10.10.10.20', port: 8080 }, callback)
        (callback) -> createNode('my:service', 'fake-guid-1-3', { address: '10.10.10.30', port: 8080 }, callback)
      ], done)

    afterEach (done) ->
      simpleExec('zkServer stop', done)

    describe 'common', ->
      beforeEach ->
        zookeeperLocator = zookeeperLocatorFactory({
          serverLocator: simpleLocatorFactory()('localhost:2181')
          path: '/discovery'
          timeout: 5000
        })

        zookeeperLocator.on LocatorException.CODE["NEW_POOL"], (path, pool) ->
          expect(path).to.equal('/my:service')
          lastSeenPool = pool
          return

        myServiceLocator = zookeeperLocator('my:service')

      it "is memoized by path", ->
        expect(myServiceLocator).to.equal(zookeeperLocator('/my:service'))

      it "correct init run", (done) ->
        getPool(myServiceLocator)
          .then((locations) ->
            expect(locations).to.deep.equal([
              '10.10.10.10:8080'
              '10.10.10.20:8080'
              '10.10.10.30:8080'
            ])
            expect(lastSeenPool.length).to.equal(3)
            done()
          )
          .done()

      it "works after removing a node", (done) ->
        async.series([
          (callback) -> removeNode('my:service', 'fake-guid-1-1', callback)
          (callback) -> setTimeout(callback, 100) # delay a little bit
        ], (err) ->
          expect(err).to.not.exist

          getPool(myServiceLocator)
            .then((locations) ->
              expect(locations).to.deep.equal([
                '10.10.10.20:8080'
                '10.10.10.30:8080'
              ])
              expect(lastSeenPool.length).to.equal(2)
              done()
            )
            .done()
        )

      it "works after adding a node", (done) ->
        async.series([
          (callback) -> createNode('my:service', 'fake-guid-1-4', { address: '10.10.10.40', port: 8080 }, callback)
          (callback) -> setTimeout(callback, 100) # delay a little bit
        ], (err) ->
          expect(err).to.not.exist
          getPool(myServiceLocator)
            .then((locations) ->
              expect(locations).to.deep.equal([
                '10.10.10.10:8080'
                '10.10.10.20:8080'
                '10.10.10.30:8080'
                '10.10.10.40:8080'
              ])
              expect(lastSeenPool.length).to.equal(4)
              done()
            )
            .done()
        )

      it "works after removing the remaining nodes", (done) ->
        async.series([
          (callback) -> rmStar('/discovery/my:service', callback)
          (callback) -> setTimeout(callback, 100) # delay a little bit
        ], (err) ->
          myServiceLocator()
            .then((location) ->
              expect(location).not.to.exist
            )
            .catch((err) ->
              expect(err).to.exist
              expect(err.message).to.equal(LocatorException.CODE["EMPTY_POOL"])
              expect(lastSeenPool.length).to.equal(0)
              done()
            )
            .done()
        )

      it "works after adding nodes to an empty pool", (done) ->
        async.series([
          (callback) -> rmStar('/discovery/my:service', callback)
          (callback) -> createNode('my:service', 'fake-guid-1-4', { address: '10.10.10.40', port: 8080 }, callback)
          (callback) -> createNode('my:service', 'fake-guid-1-5', { address: '10.10.10.50', port: 8080 }, callback)
          (callback) -> setTimeout(callback, 100) # delay a little bit
        ], (err) ->
          expect(err).to.not.exist

          getPool(myServiceLocator)
            .then((locations) ->
              expect(locations).to.deep.equal([
                '10.10.10.40:8080'
                '10.10.10.50:8080'
              ])
              done()
            )
            .done()
        )

      it "works after one error state", (done) ->
        async.series([
          (callback) -> rmStar('/discovery/my:service', callback)
          (callback) -> setTimeout(callback, 100) # delay a little bit
        ], (err) ->
          expect(err).not.to.exist

          myServiceLocator()
            .then((location) ->
              expect(location).not.to.exist
            )
            .catch((err) ->
              expect(err).to.exist
              expect(err.message).to.equal(LocatorException.CODE["EMPTY_POOL"])
              expect(lastSeenPool.length).to.equal(0)

              async.series([
                (callback) -> createNode('my:service', 'fake-guid-1-4', { address: '10.10.10.40', port: 8080 }, callback)
                (callback) -> createNode('my:service', 'fake-guid-1-5', { address: '10.10.10.50', port: 8080 }, callback)
                (callback) -> setTimeout(callback, 100) # delay a little bit
              ], (err) ->
                expect(err).to.not.exist

                getPool(myServiceLocator)
                  .then((locations) ->
                    expect(locations).to.deep.equal([
                      '10.10.10.40:8080'
                      '10.10.10.50:8080'
                    ])
                    done()
                  )
                  .done()
              )
            )
            .done()
        )

      it "works after ZK disconnects by serving the cached pool", (done) ->
        disconnectEventSeen = false
        zookeeperLocator.once 'disconnected', ->
          disconnectEventSeen = true
          return

        async.series([
          (callback) -> simpleExec('zkServer stop', callback)
          (callback) -> setTimeout(callback, 100) # delay a little bit
        ], (err) ->
          expect(err).to.not.exist
          getPool(myServiceLocator)
            .then((locations) ->
              expect(disconnectEventSeen).to.be.true
              expect(locations).to.deep.equal([
                '10.10.10.10:8080'
                '10.10.10.20:8080'
                '10.10.10.30:8080'
              ])
              expect(lastSeenPool.length).to.equal(3)
              done()
            )
            .done()
        )

      it "reconnects when ZK comes back online", (done) ->
        connectEventSeen = false
        zookeeperLocator.once 'connected', ->
          connectEventSeen = true
          return

        async.series([
          (callback) -> simpleExec('zkServer start', callback)
          (callback) -> createNode('my:service', 'fake-guid-1-7', { address: '10.10.10.40', port: 8080 }, callback)
          (callback) -> setTimeout(callback, 100) # delay a little bit
        ], (err) ->
          expect(err).to.not.exist

          getPool(myServiceLocator)
            .then((locations) ->
              expect(locations).to.deep.equal([
                '10.10.10.10:8080'
                '10.10.10.20:8080'
                '10.10.10.30:8080'
                '10.10.10.40:8080'
              ])
              expect(connectEventSeen).to.be.true
              done()
            )
            .done()
        )

    describe "in strict mode", ->
      beforeEach ->
        zookeeperLocator = zookeeperLocatorFactory({
          serverLocator: simpleLocatorFactory()('localhost:2181')
          path: '/discovery'
          timeout: 5000
          strict: true
        })

        zookeeperLocator.on LocatorException.CODE["NEW_POOL"], (path, pool) ->
          expect(path).to.equal('/my:service')
          lastSeenPool = pool
          return

        myServiceLocator = zookeeperLocator('my:service')

      it "returns an empty list when all nodes drop out after a previous successful locating", (done) ->
        getPool(myServiceLocator)
          .then((locations) ->
            expect(locations).to.deep.equal([
              '10.10.10.10:8080'
              '10.10.10.20:8080'
              '10.10.10.30:8080'
            ])
            expect(lastSeenPool.length).to.equal(3)

            async.series([
                (callback) -> rmStar('/discovery/my:service', callback)
                (callback) -> setTimeout(callback, 100) # delay a little bit
              ], (err) ->
              myServiceLocator()
              .then((location) ->
                expect(location).not.to.exist
              )
              .catch((err) ->
                expect(err).to.exist
                expect(err.message).to.equal(LocatorException.CODE["EMPTY_POOL"])
                expect(lastSeenPool.length).to.equal(0)
                done()
              )
              .done()
            )
          )
          .done()

    describe "in non-strict mode", ->
      lenientZookeeperLocator = null
      lenientMyServiceLocator = null


      beforeEach ->
        lenientZookeeperLocator = zookeeperLocatorFactory({
          serverLocator: simpleLocatorFactory()('localhost:2181')
          path: '/discovery'
          timeout: 5000
          strict: false
        })

        lenientZookeeperLocator.on LocatorException.CODE["NEW_POOL"], (path, pool) ->
          expect(path).to.equal('/my:service')
          lastSeenPool = pool
          return

        lenientMyServiceLocator = lenientZookeeperLocator('my:service')

      it "returns the last successful list when all nodes drop out after a previous successful locating", (done) ->
        getPool(lenientMyServiceLocator)
          .then((locations) ->
            expect(locations).to.deep.equal([
              '10.10.10.10:8080'
              '10.10.10.20:8080'
              '10.10.10.30:8080'
            ])
            expect(lastSeenPool.length).to.equal(3)

            async.series([
              (callback) -> rmStar('/discovery/my:service', callback)
              (callback) -> setTimeout(callback, 100) # delay a little bit
            ], (err) ->
              getPool(lenientMyServiceLocator)
                .then((locations) ->
                  expect(locations).to.deep.equal([
                    '10.10.10.10:8080'
                    '10.10.10.20:8080'
                    '10.10.10.30:8080'
                  ])
                  done()
                )
                .done()
            )
          )
          .done()


  describe "another locator after zkClient connects", ->
    beforeEach (done) ->
      async.series([
        (callback) -> simpleExec('zkServer start', callback)
        (callback) -> rmStar('/discovery/my:service', callback)
        (callback) -> createNode('my:service', 'fake-guid-1-1', { address: '10.10.10.10', port: 8080 }, callback)
        (callback) -> createNode('my:service', 'fake-guid-1-2', { address: '10.10.10.20', port: 8080 }, callback)
        (callback) -> createNode('my:service', 'fake-guid-1-3', { address: '10.10.10.30', port: 8080 }, callback)
        (callback) ->
          zookeeperLocator = zookeeperLocatorFactory({
            serverLocator: simpleLocatorFactory()('localhost:2181')
            path: '/discovery'
            timeout: 5000
          })
          callback()
      ], done)

    afterEach (done) ->
      simpleExec('zkServer stop', done)

    it "functions for the same service", (done) ->
      zookeeperLocator.once('connected', ->
        anotherLocator = zookeeperLocator('my:service')
        anotherLocator()
          .then((location) ->
            expect(location).to.exist
            done()
          )
          .done()
      )

    it "functions for a different service", (done) ->
      zookeeperLocator.once('connected', ->
        anotherLocator = zookeeperLocator('my:service2')
        anotherLocator()
          .then((location) ->
            expect(location).not.to.exist
          )
          .catch((err) ->
            expect(err.message).to.equal(LocatorException.CODE["EMPTY_POOL"])
            done()
          )
          .done()
      )


  describe "when ZK connection times out", ->
    @timeout 5000
    zookeeperLocator = null
    myServiceLocator = null

    beforeEach (done) ->
      zookeeperLocator = zookeeperLocatorFactory({
        serverLocator: simpleLocatorFactory()('localhost:2181')
        path: '/discovery'
        locatorTimeout: 2000
      })
      myServiceLocator = zookeeperLocator('my:service')
      done()

    afterEach (done) ->
      simpleExec('zkServer stop', done)

    it "times out after some time", (done) ->
      start = new Date()

      myServiceLocator()
        .then((location) ->
          expect(location).not.to.exist
        )
        .catch((err) ->
          expect(err).to.exist
          expect(err.message).to.equal('ZOOKEEPER_TIMEOUT')
          expect(Date.now() - start).to.be.closeTo(2000, 50)

          myServiceLocator()
            .then((location) ->
              expect(location).not.to.exist
            )
            .catch((err) ->
              expect(Date.now() - start).to.be.closeTo(4000, 50)
              expect(err).to.exist
              expect(err.message).to.equal('ZOOKEEPER_TIMEOUT')
              done()
            )
            .done()
        )
        .done()

    it "picks up after server start", (done) ->
      async.series [
        (callback) -> simpleExec('zkServer start', callback)
        (callback) -> rmStar('/discovery/my:service', callback)
        (callback) -> createNode('my:service', 'fake-guid-1-1', { address: '10.10.10.10', port: 8080 }, callback)
        (callback) -> setTimeout(callback, 1000) # delay a little bit
      ], (err) ->
        getPool(myServiceLocator)
          .then((locations) ->
            expect(locations).to.deep.equal([
              '10.10.10.10:8080'
            ])
            done()
          )
          .done()
