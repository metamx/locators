'use strict'

gulp = require 'gulp'
# load plugins
$ = require('gulp-load-plugins')()
spawn = require('child_process').spawn

ts = require('gulp-typescript')
tsd = require('gulp-tsd');
tslint = require('gulp-tslint');
merge = require('merge2')

# Compile jobs
path =
  src: 'src/**/*.ts'
  typings: 'typings/**/*.ts'
  test: 'test/**/*.coffee'


gulp.task('tsd', ->
  gulp.src('./gulp_tsd.json').pipe(tsd())
)

gulp.task('tslint', ->
  gulp.src(['src/**/*ts'])
    .pipe(tslint())
    .pipe(tslint.report('prose'))
)
gulp.task('compile', ['tsd', 'tslint'], ->
  tsResult = gulp.src(['src/**/*.ts','typings/**/*.ts', 'typings_custom/*.ts'])

    .pipe(ts({
      declaration: true,
      noImplicitAny: true,
      target: 'ES5',
      module: 'commonjs'
  }))

  return merge([
    tsResult.dts.pipe(gulp.dest('build')),
    tsResult.js.pipe(gulp.dest('build'))
  ])
)

# Main jobs
gulp.task('test', ->
  gulp.src([path.src, path.test], { read: false })
    .pipe($.watch([path.src, path.test], (files) ->
      files
        .pipe($.grepStream('**/*.mocha.coffee'))
        .pipe($.mocha({ reporter: 'spec' }))
        .on('error', (err) ->
          this.emit('end')
        )
    ))
)

gulp.task('watch', ->
  gulp.src([path.src], { read: false })
    .pipe($.watch([path.src], (files) ->
      files
        .pipe($.coffee({bare: true})).on('error', $.util.log)
        .pipe(gulp.dest('./build/'))
    ))
)


gulp.task('default', ['test'])
