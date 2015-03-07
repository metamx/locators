{ expect } = require("chai")

exec = require('child_process').exec
Promise = require('q')
async = require('async')
zookeeper = require('node-zookeeper-client')
{CreateMode} = zookeeper

{ simpleLocatorFactory } = require('../build/simple')
{ zookeeperLocatorFactory } = require('../build/zookeeper')

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
  describe 'normal function', ->
    @timeout 5000
    zookeeperLocator = null
    myServiceLocator = null
    lastSeenPool = null

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

          zookeeperLocator.on 'newPool', (path, pool) ->
            expect(path).to.equal('/my:service')
            lastSeenPool = pool
            return

          myServiceLocator = zookeeperLocator('my:service')
          callback()
      ], done)

    afterEach (done) ->
      simpleExec('zkServer stop', done)

    it "is memoized by path", ->
      expect(myServiceLocator).to.equal(zookeeperLocator('/my:service'))

    it "fails on fake service", (done) ->
      eventSeen = false
      zookeeperLocator.once 'childListFail', (path, err) ->
        eventSeen = true
        expect(path).to.equal('/my:fake:service')
        expect(err.message).to.equal('Exception: NO_NODE[-101]')
        return

      myFakeServiceLocator = zookeeperLocator('my:fake:service')
      myFakeServiceLocator()
        .then((location) ->
          expect(location).not.to.exist
        )
        .catch((err) ->
          expect(err).to.exist
          expect(err.message).to.equal('Empty pool')
          expect(eventSeen).to.be.true
          done()
        )
        .done()

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
        (callback) -> removeNode('my:service', 'fake-guid-1-1', callback)
        (callback) -> removeNode('my:service', 'fake-guid-1-2', callback)
        (callback) -> removeNode('my:service', 'fake-guid-1-3', callback)
        (callback) -> setTimeout(callback, 100) # delay a little bit
      ], (err) ->
        myServiceLocator()
          .then((location) ->
            expect(location).not.to.exist
          )
          .catch((err) ->
            expect(err).to.exist
            expect(err.message).to.equal('Empty pool')
            expect(lastSeenPool.length).to.equal(0)
            done()
          )
          .done()
      )

    it "works after adding nodes to an empty pool", (done) ->
      async.series([
        (callback) -> removeNode('my:service', 'fake-guid-1-1', callback)
        (callback) -> removeNode('my:service', 'fake-guid-1-2', callback)
        (callback) -> removeNode('my:service', 'fake-guid-1-3', callback)
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

    it "works after ZK disconnects serving the remainder from cache", (done) ->
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

  describe "ZK connection timeout", ->
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
        (callback) -> setTimeout(callback, 100) # delay a little bit
      ], (err) ->
        getPool(myServiceLocator)
          .then((locations) ->
            expect(locations).to.deep.equal([
              '10.10.10.10:8080'
            ])
            done()
          )
          .done()
