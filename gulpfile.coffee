'use strict'

gulp = require 'gulp'
# load plugins
$ = require('gulp-load-plugins')()
spawn = require('child_process').spawn

# Compile jobs
path =
  src: 'src/**/*.ts'
  test: 'test/**/*.coffee'




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
