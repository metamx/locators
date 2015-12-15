module.exports = (grunt) ->
  'use strict'
  grunt.loadNpmTasks('grunt-contrib-copy')
  grunt.loadNpmTasks('grunt-contrib-watch')
  grunt.loadNpmTasks('grunt-ts')
  grunt.loadNpmTasks('grunt-tslint')
  grunt.loadNpmTasks('grunt-tsd')
  grunt.loadNpmTasks('dts-generator')

  config =
    ts:
      options:
        target: 'es5'
        module: 'commonjs'
        declaration: true
        emitDecoratorMetadata: true
        failOnTypeErrors: false
        noEmitHelpers: true
        sourceMap: false
      build:
        src:  [ 'src/*.ts', 'typings/**/*.ts', 'typings_custom/*.ts' ]
        outDir: 'build/'
        baseDir: 'src/'
      'build-dev':
        src:  [ 'src/*.ts', 'typings/**/*.ts', 'typings_custom/*.ts' ]
        outDir: 'build/'
        baseDir: 'src/'
        options:
          sourceMap: true

    tslint:
      options:
        configuration: grunt.file.readJSON("tslint.json")
      files:
        src: [ 'src/**/*.ts' ]

    tsd:
      load:
        options:
          command: 'reinstall'
          latest: false
          config: 'tsd.json'
      refresh:
        options:
          command: 'reinstall'
          latest: true
          config: 'tsd.json'

    dtsGenerator:
      options:
        name: 'locators'
        baseDir: 'src/'
        out: 'build/locators.d.ts'
        main: 'locators/index'
      default:
        src: [ 'src/**/*.ts' ]



    watch:
      typescripts:
        files: 'src/**/*.ts'
        tasks: [ 'watch-compile' ]
        options:
          livereload: true


  grunt.initConfig(config)

  grunt.registerTask 'compile', [
    'tsd:load',
    'tslint',
    'ts:build',
    'dtsGenerator'
  ]

  grunt.registerTask 'compile-dev', [
    'tsd:load',
    'tslint',
    'ts:build-dev',
    'dtsGenerator'
  ]

  grunt.registerTask 'default', ['compile']

  grunt.registerTask 'watch-compile', [
    'tslint',
    'ts:build',
    'dtsGenerator'
  ]

  return