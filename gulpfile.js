var gulp = require('gulp');
var $ = require('gulp-load-plugins')();
var browserSync = require('browser-sync');
var argv = require('yargs').argv;
var gutil = require('gulp-util');
var del = require('del');
var runSequence = require('run-sequence');
var fs = require('fs');
var path = require('path');
var merge = require('merge-stream');
var siteGenerator = require('./modules/metalsmith');
var parallelize = require("concurrent-transform");

//--

var lang = argv.lang === 'en' ? 'en' : 'ja';
var env = argv.production ? 'production' : 'staging';

gutil.log('Language: --lang=' + lang);
gutil.log('Environment: ' + env);
gutil.log('Source: \'./src/documents_' + lang + '\'');
gutil.log('Destination: \'./out_' + lang + '\'');

//////////////////////////////
// generate
//////////////////////////////
gulp.task('generate', ['less', 'metalsmith', 'blog', 'authors']);

//////////////////////////////
// blog
//////////////////////////////
gulp.task('blog', function(done) {
  siteGenerator(lang, env === 'staging').blog(done);
});

//////////////////////////////
// authors
//////////////////////////////
gulp.task('authors', function(done) {
  siteGenerator(lang, env === 'staging').authors(done);
});

//////////////////////////////
// metalsmith
//////////////////////////////
gulp.task('metalsmith', function(done) {
  siteGenerator(lang, env === 'staging').site(done);
});

//////////////////////////////
// imagemin
//////////////////////////////
gulp.task('imagemin-core', function() {
  return gulp.src('src/files/images/**/*')
    .pipe($.imagemin())
    .pipe(gulp.dest('src/files/images/'));
});

gulp.task('imagemin-blog', function() {
  return gulp.src('blog/content/images/**/*')
    .pipe($.imagemin())
    .pipe(gulp.dest('blog/content/images/'));
});

gulp.task('imagemin', ['imagemin-core', 'imagemin-blog']);

//////////////////////////////
// less
//////////////////////////////
gulp.task('less', function() {
  return gulp.src(['src/less/main.less', 'src/less/blog.less'])
    .pipe($.plumber())
    .pipe($.less())
    .pipe($.autoprefixer({
      browsers: ['last 4 versions'],
      cascade: false
    }))
    .pipe($.cssmin())
    .pipe(gulp.dest('./out_' + lang + '/css/'));
});

//////////////////////////////
// clean
//////////////////////////////
gulp.task('clean', function(done) {
  del([
    'out_' + lang + '/*'
  ], done);
});

//////////////////////////////
// serve
//////////////////////////////
gulp.task('serve', ['generate'], function() {
  browserSync({
    server: {
      baseDir: 'out_' + lang,
      index: 'index.html'
    },
    notify: false,
    open: false,
    injectChanges: true
  });

  var options = {
    debounceDelay: 400
  };

  gulp.watch([
    'src/documents_' + lang + '/**/*',
    'dist/v1/OnsenUI/build/docs/' + lang + '/partials/*/*.html',
    'dist/v2/OnsenUI/build/docs/' + lang + '/partials/*/*.html',
    'src/layouts/*',
    'src/misc/*',
    'src/partials/*',
    'src/files/**/*',
  ], options, function() {
    runSequence(['metalsmith', 'blog', 'authors'], function() {
      browserSync.reload();
    });
  });

  gulp.watch([
    'src/less/*'
  ], options, function() {
    runSequence('less', function() {
      browserSync.reload();
    });
  });

  if (lang === 'en') {
    gulp.watch([
      'blog/*',
      'blog/posts/*',
      'blog/authors/*',
      'blog/content/**/*',
      'src/partials/*',
      'src/layouts/blog.html.eco'
    ], options, function() {
      runSequence('blog', function() {
        browserSync.reload();
      });
    });
  } else if (lang === 'ja') {
    gulp.watch([
      'blog_ja/*',
      'blog_ja/posts/*',
      'blog_ja/authors/*',
      'blog_ja/content/**/*',
      'src/partials/*',
      'src/layouts/blog_ja.html.eco'
    ], options, function() {
      runSequence('blog', function() {
        browserSync.reload();
      });
    });
  } 
});

//////////////////////////////
// deploy
//////////////////////////////
gulp.task('deploy', [], function(done) {
  runSequence('clean', 'generate', 'deploy-aws', done);
});

gulp.task('deploy-aws', function() {
  var aws,
      aws_config = 'aws_' + lang + (env == 'production' ? '_prod' : '') + '.json';

  if (fs.existsSync(path.join(__dirname, aws_config))) {
    gutil.log("Loading from AWS config file.");
    aws = JSON.parse(fs.readFileSync(path.join(__dirname, aws_config)));
  } else if (process.env.AWS_KEY) {
    gutil.log("Loading from environment variable.");
    aws = {
      accessKeyId: process.env.AWS_KEY,
      secretAccessKey: process.env.AWS_SECRET,
      region: process.env.AWS_REGION,
      params: {
        Bucket: process.env.AWS_BUCKET
      }
    };
  }

  if (!aws) {
    throw new Error('AWS configuration is missing! Please create a config file, or set it in the environment before trying to deploy!');
  }

  var dst = 'out_' + lang;
  var publisher = $.awspublish.create(aws);

  var site = gulp.src([
    dst + '/**',
    '!' + dst + '/dist',
  ]);

  var headers = env == 'production' ? {'Cache-Control': 'max-age=7200, no-transform, public'} : {'Cache-Control': 'no-cache'};

  var stream = merge(site)
    .pipe(parallelize(publisher.publish(headers), 10))
    .pipe(publisher.sync())
    .pipe($.awspublish.reporter());

  return stream;
});
