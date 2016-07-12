var areaType='currentView';
var drawnLayer;
var mainLayer,ntaLayer;
var nPolygon;

//initialize map
var map = new L.Map('map', { 
  center: [40.70663644882689,-73.97815704345703],
  zoom: 14
});

var selectLayer = L.geoJson().addTo(map); //add empty geojson layer for selections

//leaflet draw stuff

// this section restricts the type of layers available for a user to draw
var options = {
    position: 'topright',
    draw: {
        polyline:false,
        polygon: {
            allowIntersection: false, // Restricts shapes to simple polygons
            drawError: {
                color: '#e1e100', // Color the shape will turn when intersects
                message: '<strong>Oh snap!<strong> you can\'t draw that!' // Message that will show when intersect
            },
            shapeOptions: {
                color: '#bada55'
            }
        },
        circle: false, // Turns off this drawing tool
        rectangle: {
            shapeOptions: {
                clickable: false
            }
        },
        marker:false
    }
};

var drawControl = new L.Control.Draw(options);
map.addControl(drawControl);
$('.leaflet-draw-toolbar').hide();

var customPolygon;
map.on('draw:created', function (e) { //user initiates action (draw:created), and function is executed
    //hide the arrow
    $('.infoArrow').hide();

    var type = e.layerType, 
        layer = e.layer; //retrieves properties of event triggered by user action
		// layerType could be [polyline, polygon, rectangle, circle, marker], except in this case since 
		//    polylines, circles, and markers have been restricted

    console.log(e.layer); //possibly used to save layer information for later (to be used by cartoDB)
    drawnLayer=e.layer; 

    var coords = e.layer._latlngs; //keeps track of latitude and longitude of the event layer
    console.log(coords); //logs the coordinates
    customPolygon = makeSqlPolygon(coords); // see line 264 for the makeSqlPolygon function (this is written in postgis)
    // Do whatever else you need to. (save to db, add to map etc)
    map.addLayer(layer);
    $('.download').removeAttr('disabled'); //ended here on 06/21/2016
});

map.on('draw:drawstart', function (e) {
  console.log('start');
  if (drawnLayer) {
    map.removeLayer(drawnLayer);
  }
});

//add cartodb named map
var layerUrl = 'https://nycem.carto.com/u/imorey/api/v2/viz/217510a8-447a-11e6-81f4-0e05a8b3e3d7/viz.json';

cartodb.createLayer(map, layerUrl)
  .addTo(map)
  .on('done', function(layer) {
    mainLayer = layer.getSubLayer(0);
    mainLayer.setInteraction(false);

    ntaLayer = layer.getSubLayer(1); 
    ntaLayer.hide();  //hide neighborhood polygons
    ntaLayer.on('featureClick', processNeighborhood);
  });

//populate fields list
$.getJSON('data/fields.json',function(data){

  console.log(data.length);
  data.forEach(function(field) {
    var listItem = '<li id = "' + field.name + '" class="list-group-item">' 
      + field.name 
      + '<span class="glyphicon glyphicon-info-sign icon-right" aria-hidden="true"></span></li>'
    
    $('.fieldList').append(listItem);
    $('#' + field.name).data("description",field.description);
    
  });

  //listener for hovers
  $('.icon-right').hover(showDescription,hideDescription);

  function showDescription() {
    var o = $(this).offset();

    var data = $(this).parent().data('description');

    $('#infoWindow')
      .html(data)
      .css('top',o.top-10)
      .css('left',o.left+30)
      .fadeIn(150);
  }

  function hideDescription() {
    $('#infoWindow')
      .fadeOut(150);
  }


  //custom functionality for checkboxes
  initCheckboxes();
});

//$('#splashModal').modal('show');

//listeners
$('#selectAll').click(function(){
  $(".fieldList li").click(); 
  listChecked();
}); 

//radio buttons
$('input[type=radio][name=area]').change(function() {
  //reset all the things
  ntaLayer.hide();
  selectLayer.clearLayers();
  $('.leaflet-draw-toolbar').hide();
  if (drawnLayer) {
    map.removeLayer(drawnLayer);
  }

  //turn on certain things
  if(this.value == 'polygon') {
    areaType='polygon';
    $('.leaflet-draw-toolbar').show();
    $('.download').attr('disabled','disabled');
  }
  if(this.value == 'currentView') {
    areaType='currentView';
  }
  if(this.value == 'neighborhood') {
    areaType='neighborhood';
    ntaLayer.show();
    $('.download').attr('disabled','disabled');
  }
})

//runs when any of the download buttons is clicked
$('.download').click(function(){

  var data = {};

  //get current view, download type, and checked fields
  var bbox = map.getBounds();
  data.intersects = customPolygon;
  data.type = $(this).attr('id');
  var checked = listChecked();

  //generate comma-separated list of fields
  data.fields = '';
  for(var i=0;i<checked.length;i++) {
    data.fields+= checked[i] + ',';
  }

  //only add leading comma if at least one field is selected
  if(data.fields.length>0) {
    data.fields=',' + data.fields.slice(0,-1);
  }
  

  if(areaType == 'currentView') {
    var bboxString = bbox._southWest.lng + ',' 
    + bbox._southWest.lat + ','
    + bbox._northEast.lng + ','
    + bbox._northEast.lat;

    data.intersects = 'ST_MakeEnvelope(' + bboxString + ',4326)';
  }

  if(areaType == 'polygon') {
    data.intersects = customPolygon;
  }

  if(areaType == 'neighborhood') {
    data.intersects = nPolygon;
  }
  
  if(data.type == 'cartodb') {
    data.type = 'geojson';
    data.cartodb = true;
  }

  var queryTemplate = 'https://cwhong.cartodb.com/api/v2/sql?skipfields=cartodb_id,created_at,updated_at,name,description&format={{type}}&filename=pluto&q=SELECT the_geom{{fields}} FROM pluto15v1 a WHERE ST_INTERSECTS({{{intersects}}}, a.the_geom)';


  var buildquery = Handlebars.compile(queryTemplate);

  var url = buildquery(data);

  console.log("Downloading " + url);

  //http://oneclick.cartodb.com/?file={{YOUR FILE URL}}&provider={{PROVIDER NAME}}&logo={{YOUR LOGO URL}}
  if(data.cartodb) {
    //open in cartodb only works if you encodeURIcomponent() on the SQL, 
    //then concatenate with the rest of the URL, then encodeURIcomponent() the whole thing

    //first, get the SQL
    var sql = url.split("q=");
    sql = encodeURIComponent(sql[1]);


    url = url.split("SELECT")[0];
    url += sql;

    url = encodeURIComponent(url);
    console.log(url);
    url = 'http://oneclick.cartodb.com/?file=' + url;
  } 
    
  window.open(url, 'My Download');
  

   

});

//functions

//when a polygon is clicked in Neighborhood View, download its geojson, etc
function processNeighborhood(e, latlng, pos, data, layer) {

  var nid = data.cartodb_id;
  selectLayer.clearLayers();

  var sql = new cartodb.SQL({ user: 'cwhong' });
  sql.execute("SELECT the_geom FROM nynta WHERE cartodb_id = {{id}}", 
    { 
      id: data.cartodb_id 
    },
    {
      format:'geoJSON'
    }
  )
  .done(function(data) {
    console.log(data);
    selectLayer.addData(data);
    //setup SQL statement for intersection
    nPolygon = '(SELECT the_geom FROM nynta WHERE cartodb_id = ' + nid + ')';
  })
}

//turns an array of latLngs into an ST_POLYGONFROMTEXT
function makeSqlPolygon(coords) {
  var s = "ST_SETSRID(ST_PolygonFromText(\'POLYGON((";
  var firstCoord;
  coords.forEach(function(coord,i){
    console.log(coord);
    s+=coord.lng + " " + coord.lat + ","

    //remember the first coord
    if(i==0) {
      firstCoord = coord;
    }

    if(i==coords.length-1) {
      s+=firstCoord.lng + " " + firstCoord.lat;
    }
  });
  s+="))\'),4326)"
  console.log(s);
  return s;
}

function initCheckboxes() {
  //sweet checkbox list from http://bootsnipp.com/snippets/featured/checked-list-group
  $('.list-group.checked-list-box .list-group-item').each(function () {
      
      // Settings
      var $widget = $(this),
          $checkbox = $('<input type="checkbox" class="hidden" />'),
          color = ($widget.data('color') ? $widget.data('color') : "primary"),
          style = ($widget.data('style') == "button" ? "btn-" : "list-group-item-"),
          settings = {
              on: {
                  icon: 'glyphicon glyphicon-check'
              },
              off: {
                  icon: 'glyphicon glyphicon-unchecked'
              }
          };
          
      $widget.css('cursor', 'pointer')
      $widget.append($checkbox);

      // Event Handlers
      $widget.on('click', function () {
          $checkbox.prop('checked', !$checkbox.is(':checked'));
          $checkbox.triggerHandler('change');
          updateDisplay();
      });
      $checkbox.on('change', function () {
          updateDisplay();
      });
        

      // Actions
      function updateDisplay() {
          var isChecked = $checkbox.is(':checked');

          // Set the button's state
          $widget.data('state', (isChecked) ? "on" : "off");

          // Set the button's icon
          $widget.find('.state-icon')
              .removeClass()
              .addClass('state-icon ' + settings[$widget.data('state')].icon);

          // Update the button's color
          if (isChecked) {
              $widget.addClass(style + color + ' active');
          } else {
              $widget.removeClass(style + color + ' active');
          }
      }

      // Initialization
      function init() {
          
          if ($widget.data('checked') == true) {
              $checkbox.prop('checked', !$checkbox.is(':checked'));
          }
          
          updateDisplay();

          // Inject the icon if applicable
          if ($widget.find('.state-icon').length == 0) {
            $widget.prepend('<span class="state-icon ' + settings[$widget.data('state')].icon + '"></span>');
          }
      }
      init();
  });
};

function listChecked() { 
  var checkedItems = [];
  $(".fieldList li.active").each(function(idx, li) {
      checkedItems.push($(li).text());
  });
  console.log(checkedItems);
  return checkedItems;
}


$( document ).ready(function() {
    $('.js-about').click(function() {

      $('#modal').fadeIn();
    });

    $('#modal').click(function() {
      $(this).fadeOut();
    });

    $('.modal-inner').click(function(event) {
      event.stopPropagation();
    });

    $(document).on('keyup',function(evt) {
        if (evt.keyCode == 27) {
          if ($('#modal').css('display')=='block') {
           $('#modal').fadeOut();
          }
        }
    });

    var scrollShadow = (function() {
    var elem, width, height, offset,
        shadowTop, shadowBottom,
        timeout;
    
    function initShadows() {
      shadowTop = $("<div>")
        .addClass("shadow-top")
        .insertAfter(elem);
      shadowBottom = $("<div>")
        .addClass("shadow-bottom")
        .insertAfter(elem)
        .css('display', 'block');
    }
    
    function calcPosition() {
      width = elem.outerWidth();
      height = elem.outerHeight();
      offset = elem.position();  

      // update 
      shadowTop.css({
        width: width + "px",
        top: offset.top + "px",
        left: offset.left + "px"
      });
      shadowBottom.css({
        width: width + "px",
        top: (offset.top + height-40) + "px",
        left: offset.left + "px"
      });
    }
    function addScrollListener() {
      elem.off("scroll.shadow");
      elem.on("scroll.shadow", function () {
        if (elem.scrollTop() > 0) {
          shadowTop.fadeIn(125);
        } else {
          shadowTop.fadeOut(125);
        }
        if (elem.scrollTop() + height >= elem[0].scrollHeight && elem.scrollTop()!==0 ) {
          shadowBottom.fadeOut(125);
        } else {
          shadowBottom.fadeIn(125);
        }
      });
    }
    function addResizeListener() {
      $(window).on("resize.shadow", function(){ 
        clearTimeout(timeout);
        timeout = setTimeout(function() {
          calcPosition();
          elem.trigger("scroll.shadow");
        }, 10);
      });
    }
    return {
      init: function(par) {
        elem = $(par);
        initShadows();
        calcPosition();
        addScrollListener();
        addResizeListener();
        elem.trigger("scroll.shadow");
      },
      update: calcPosition
    };
    
  }());
  // start
  scrollShadow.init(".well-inner");
});