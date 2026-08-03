try {
"use strict";
(() => {
  // node_modules/@nitrots/nitro-renderer/src/nitro/communication/messages/parser/room/mapping/FloorHeightMapMessageParser.ts
  var FloorHeightMapMessageParser = class _FloorHeightMapMessageParser {
    static TILE_BLOCKED = -110;
    _model;
    _width;
    _height;
    _heightMap;
    _wallHeight;
    _scale;
    flush() {
      this._model = null;
      this._width = 0;
      this._height = 0;
      this._wallHeight = -1;
      this._heightMap = [];
      this._scale = 64;
      this._model = null;
      return true;
    }
    parse(wrapper) {
      if (!wrapper) return false;
      const scale = wrapper.readBoolean();
      const wallHeight = wrapper.readInt();
      const model = wrapper.readString();
      return this.parseExplicitly(model, wallHeight, scale);
    }
    parseModel(modelString, wallHeight, scale = true) {
      return this.parseExplicitly(modelString, wallHeight, scale);
    }
    parseExplicitly(modelString, wallHeight, scale = true) {
      this._scale = scale ? 32 : 64;
      this._wallHeight = wallHeight;
      this._model = modelString;
      const model = this._model.split("\r");
      const modelRows = model.length;
      let width = 0;
      const height = 0;
      let iterator = 0;
      while (iterator < modelRows) {
        const row = model[iterator];
        if (row.length > width) {
          width = row.length;
        }
        iterator++;
      }
      this._heightMap = [];
      iterator = 0;
      while (iterator < modelRows) {
        const heightMap = [];
        let subIterator = 0;
        while (subIterator < width) {
          heightMap.push(_FloorHeightMapMessageParser.TILE_BLOCKED);
          subIterator++;
        }
        this._heightMap.push(heightMap);
        iterator++;
      }
      this._width = width;
      this._height = modelRows;
      iterator = 0;
      while (iterator < modelRows) {
        const heightMap = this._heightMap[iterator];
        const text = model[iterator];
        if (text.length > 0) {
          let subIterator = 0;
          while (subIterator < text.length) {
            const char = text.charAt(subIterator);
            let height2 = _FloorHeightMapMessageParser.TILE_BLOCKED;
            if (char !== "x" && char !== "X") height2 = parseInt(char, 36);
            heightMap[subIterator] = height2;
            subIterator++;
          }
        }
        iterator++;
      }
      return true;
    }
    getHeight(x, y) {
      if (x < 0 || x >= this._width || y < 0 || y >= this._height) return -110;
      const row = this._heightMap[y];
      if (row === void 0) return -110;
      const height = row[x];
      if (height === void 0) return -110;
      return height;
    }
    get model() {
      return this._model;
    }
    get width() {
      return this._width;
    }
    get height() {
      return this._height;
    }
    get heightMap() {
      return this._heightMap;
    }
    get wallHeight() {
      return this._wallHeight;
    }
    get scale() {
      return this._scale;
    }
  };

  // node_modules/@nitrots/nitro-renderer/src/room/messages/RoomObjectUpdateMessage.ts
  var RoomObjectUpdateMessage = class {
    _location;
    _direction;
    constructor(location, direction) {
      this._location = location;
      this._direction = direction;
    }
    get location() {
      return this._location;
    }
    get direction() {
      return this._direction;
    }
  };

  // node_modules/@nitrots/nitro-renderer/src/nitro/room/messages/ObjectRoomMapUpdateMessage.ts
  var ObjectRoomMapUpdateMessage = class _ObjectRoomMapUpdateMessage extends RoomObjectUpdateMessage {
    static UPDATE_MAP = "RORMUM_UPDATE_MAP";
    _type;
    _mapData;
    constructor(mapData) {
      super(null, null);
      this._type = _ObjectRoomMapUpdateMessage.UPDATE_MAP;
      this._mapData = mapData;
    }
    get type() {
      return this._type;
    }
    get mapData() {
      return this._mapData;
    }
  };

  // node_modules/@nitrots/nitro-renderer/src/api/nitro/room/object/RoomObjectCategory.ts
  var RoomObjectCategory = class {
    static MINIMUM = -2;
    static ROOM = 0;
    static FLOOR = 10;
    static WALL = 20;
    static UNIT = 100;
    static CURSOR = 200;
  };

  // node_modules/@pixi/math/dist/esm/math.js
  var PI_2 = Math.PI * 2;
  var RAD_TO_DEG = 180 / Math.PI;
  var DEG_TO_RAD = Math.PI / 180;
  var SHAPES;
  (function(SHAPES2) {
    SHAPES2[SHAPES2["POLY"] = 0] = "POLY";
    SHAPES2[SHAPES2["RECT"] = 1] = "RECT";
    SHAPES2[SHAPES2["CIRC"] = 2] = "CIRC";
    SHAPES2[SHAPES2["ELIP"] = 3] = "ELIP";
    SHAPES2[SHAPES2["RREC"] = 4] = "RREC";
  })(SHAPES || (SHAPES = {}));
  var Point = (
    /** @class */
    function() {
      function Point2(x, y) {
        if (x === void 0) {
          x = 0;
        }
        if (y === void 0) {
          y = 0;
        }
        this.x = 0;
        this.y = 0;
        this.x = x;
        this.y = y;
      }
      Point2.prototype.clone = function() {
        return new Point2(this.x, this.y);
      };
      Point2.prototype.copyFrom = function(p) {
        this.set(p.x, p.y);
        return this;
      };
      Point2.prototype.copyTo = function(p) {
        p.set(this.x, this.y);
        return p;
      };
      Point2.prototype.equals = function(p) {
        return p.x === this.x && p.y === this.y;
      };
      Point2.prototype.set = function(x, y) {
        if (x === void 0) {
          x = 0;
        }
        if (y === void 0) {
          y = x;
        }
        this.x = x;
        this.y = y;
        return this;
      };
      Point2.prototype.toString = function() {
        return "[@pixi/math:Point x=" + this.x + " y=" + this.y + "]";
      };
      return Point2;
    }()
  );
  var tempPoints = [new Point(), new Point(), new Point(), new Point()];
  var Rectangle = (
    /** @class */
    function() {
      function Rectangle2(x, y, width, height) {
        if (x === void 0) {
          x = 0;
        }
        if (y === void 0) {
          y = 0;
        }
        if (width === void 0) {
          width = 0;
        }
        if (height === void 0) {
          height = 0;
        }
        this.x = Number(x);
        this.y = Number(y);
        this.width = Number(width);
        this.height = Number(height);
        this.type = SHAPES.RECT;
      }
      Object.defineProperty(Rectangle2.prototype, "left", {
        /** Returns the left edge of the rectangle. */
        get: function() {
          return this.x;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(Rectangle2.prototype, "right", {
        /** Returns the right edge of the rectangle. */
        get: function() {
          return this.x + this.width;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(Rectangle2.prototype, "top", {
        /** Returns the top edge of the rectangle. */
        get: function() {
          return this.y;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(Rectangle2.prototype, "bottom", {
        /** Returns the bottom edge of the rectangle. */
        get: function() {
          return this.y + this.height;
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(Rectangle2, "EMPTY", {
        /** A constant empty rectangle. */
        get: function() {
          return new Rectangle2(0, 0, 0, 0);
        },
        enumerable: false,
        configurable: true
      });
      Rectangle2.prototype.clone = function() {
        return new Rectangle2(this.x, this.y, this.width, this.height);
      };
      Rectangle2.prototype.copyFrom = function(rectangle) {
        this.x = rectangle.x;
        this.y = rectangle.y;
        this.width = rectangle.width;
        this.height = rectangle.height;
        return this;
      };
      Rectangle2.prototype.copyTo = function(rectangle) {
        rectangle.x = this.x;
        rectangle.y = this.y;
        rectangle.width = this.width;
        rectangle.height = this.height;
        return rectangle;
      };
      Rectangle2.prototype.contains = function(x, y) {
        if (this.width <= 0 || this.height <= 0) {
          return false;
        }
        if (x >= this.x && x < this.x + this.width) {
          if (y >= this.y && y < this.y + this.height) {
            return true;
          }
        }
        return false;
      };
      Rectangle2.prototype.intersects = function(other, transform) {
        if (!transform) {
          var x0_1 = this.x < other.x ? other.x : this.x;
          var x1_1 = this.right > other.right ? other.right : this.right;
          if (x1_1 <= x0_1) {
            return false;
          }
          var y0_1 = this.y < other.y ? other.y : this.y;
          var y1_1 = this.bottom > other.bottom ? other.bottom : this.bottom;
          return y1_1 > y0_1;
        }
        var x0 = this.left;
        var x1 = this.right;
        var y0 = this.top;
        var y1 = this.bottom;
        if (x1 <= x0 || y1 <= y0) {
          return false;
        }
        var lt = tempPoints[0].set(other.left, other.top);
        var lb = tempPoints[1].set(other.left, other.bottom);
        var rt = tempPoints[2].set(other.right, other.top);
        var rb = tempPoints[3].set(other.right, other.bottom);
        if (rt.x <= lt.x || lb.y <= lt.y) {
          return false;
        }
        var s = Math.sign(transform.a * transform.d - transform.b * transform.c);
        if (s === 0) {
          return false;
        }
        transform.apply(lt, lt);
        transform.apply(lb, lb);
        transform.apply(rt, rt);
        transform.apply(rb, rb);
        if (Math.max(lt.x, lb.x, rt.x, rb.x) <= x0 || Math.min(lt.x, lb.x, rt.x, rb.x) >= x1 || Math.max(lt.y, lb.y, rt.y, rb.y) <= y0 || Math.min(lt.y, lb.y, rt.y, rb.y) >= y1) {
          return false;
        }
        var nx = s * (lb.y - lt.y);
        var ny = s * (lt.x - lb.x);
        var n00 = nx * x0 + ny * y0;
        var n10 = nx * x1 + ny * y0;
        var n01 = nx * x0 + ny * y1;
        var n11 = nx * x1 + ny * y1;
        if (Math.max(n00, n10, n01, n11) <= nx * lt.x + ny * lt.y || Math.min(n00, n10, n01, n11) >= nx * rb.x + ny * rb.y) {
          return false;
        }
        var mx = s * (lt.y - rt.y);
        var my = s * (rt.x - lt.x);
        var m00 = mx * x0 + my * y0;
        var m10 = mx * x1 + my * y0;
        var m01 = mx * x0 + my * y1;
        var m11 = mx * x1 + my * y1;
        if (Math.max(m00, m10, m01, m11) <= mx * lt.x + my * lt.y || Math.min(m00, m10, m01, m11) >= mx * rb.x + my * rb.y) {
          return false;
        }
        return true;
      };
      Rectangle2.prototype.pad = function(paddingX, paddingY) {
        if (paddingX === void 0) {
          paddingX = 0;
        }
        if (paddingY === void 0) {
          paddingY = paddingX;
        }
        this.x -= paddingX;
        this.y -= paddingY;
        this.width += paddingX * 2;
        this.height += paddingY * 2;
        return this;
      };
      Rectangle2.prototype.fit = function(rectangle) {
        var x1 = Math.max(this.x, rectangle.x);
        var x2 = Math.min(this.x + this.width, rectangle.x + rectangle.width);
        var y1 = Math.max(this.y, rectangle.y);
        var y2 = Math.min(this.y + this.height, rectangle.y + rectangle.height);
        this.x = x1;
        this.width = Math.max(x2 - x1, 0);
        this.y = y1;
        this.height = Math.max(y2 - y1, 0);
        return this;
      };
      Rectangle2.prototype.ceil = function(resolution, eps) {
        if (resolution === void 0) {
          resolution = 1;
        }
        if (eps === void 0) {
          eps = 1e-3;
        }
        var x2 = Math.ceil((this.x + this.width - eps) * resolution) / resolution;
        var y2 = Math.ceil((this.y + this.height - eps) * resolution) / resolution;
        this.x = Math.floor((this.x + eps) * resolution) / resolution;
        this.y = Math.floor((this.y + eps) * resolution) / resolution;
        this.width = x2 - this.x;
        this.height = y2 - this.y;
        return this;
      };
      Rectangle2.prototype.enlarge = function(rectangle) {
        var x1 = Math.min(this.x, rectangle.x);
        var x2 = Math.max(this.x + this.width, rectangle.x + rectangle.width);
        var y1 = Math.min(this.y, rectangle.y);
        var y2 = Math.max(this.y + this.height, rectangle.y + rectangle.height);
        this.x = x1;
        this.width = x2 - x1;
        this.y = y1;
        this.height = y2 - y1;
        return this;
      };
      Rectangle2.prototype.toString = function() {
        return "[@pixi/math:Rectangle x=" + this.x + " y=" + this.y + " width=" + this.width + " height=" + this.height + "]";
      };
      return Rectangle2;
    }()
  );
  var Circle = (
    /** @class */
    function() {
      function Circle2(x, y, radius) {
        if (x === void 0) {
          x = 0;
        }
        if (y === void 0) {
          y = 0;
        }
        if (radius === void 0) {
          radius = 0;
        }
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.type = SHAPES.CIRC;
      }
      Circle2.prototype.clone = function() {
        return new Circle2(this.x, this.y, this.radius);
      };
      Circle2.prototype.contains = function(x, y) {
        if (this.radius <= 0) {
          return false;
        }
        var r2 = this.radius * this.radius;
        var dx = this.x - x;
        var dy = this.y - y;
        dx *= dx;
        dy *= dy;
        return dx + dy <= r2;
      };
      Circle2.prototype.getBounds = function() {
        return new Rectangle(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2);
      };
      Circle2.prototype.toString = function() {
        return "[@pixi/math:Circle x=" + this.x + " y=" + this.y + " radius=" + this.radius + "]";
      };
      return Circle2;
    }()
  );
  var Ellipse = (
    /** @class */
    function() {
      function Ellipse2(x, y, halfWidth, halfHeight) {
        if (x === void 0) {
          x = 0;
        }
        if (y === void 0) {
          y = 0;
        }
        if (halfWidth === void 0) {
          halfWidth = 0;
        }
        if (halfHeight === void 0) {
          halfHeight = 0;
        }
        this.x = x;
        this.y = y;
        this.width = halfWidth;
        this.height = halfHeight;
        this.type = SHAPES.ELIP;
      }
      Ellipse2.prototype.clone = function() {
        return new Ellipse2(this.x, this.y, this.width, this.height);
      };
      Ellipse2.prototype.contains = function(x, y) {
        if (this.width <= 0 || this.height <= 0) {
          return false;
        }
        var normx = (x - this.x) / this.width;
        var normy = (y - this.y) / this.height;
        normx *= normx;
        normy *= normy;
        return normx + normy <= 1;
      };
      Ellipse2.prototype.getBounds = function() {
        return new Rectangle(this.x - this.width, this.y - this.height, this.width, this.height);
      };
      Ellipse2.prototype.toString = function() {
        return "[@pixi/math:Ellipse x=" + this.x + " y=" + this.y + " width=" + this.width + " height=" + this.height + "]";
      };
      return Ellipse2;
    }()
  );
  var Polygon = (
    /** @class */
    function() {
      function Polygon2() {
        var arguments$1 = arguments;
        var points = [];
        for (var _i = 0; _i < arguments.length; _i++) {
          points[_i] = arguments$1[_i];
        }
        var flat = Array.isArray(points[0]) ? points[0] : points;
        if (typeof flat[0] !== "number") {
          var p = [];
          for (var i = 0, il = flat.length; i < il; i++) {
            p.push(flat[i].x, flat[i].y);
          }
          flat = p;
        }
        this.points = flat;
        this.type = SHAPES.POLY;
        this.closeStroke = true;
      }
      Polygon2.prototype.clone = function() {
        var points = this.points.slice();
        var polygon = new Polygon2(points);
        polygon.closeStroke = this.closeStroke;
        return polygon;
      };
      Polygon2.prototype.contains = function(x, y) {
        var inside = false;
        var length = this.points.length / 2;
        for (var i = 0, j = length - 1; i < length; j = i++) {
          var xi = this.points[i * 2];
          var yi = this.points[i * 2 + 1];
          var xj = this.points[j * 2];
          var yj = this.points[j * 2 + 1];
          var intersect = yi > y !== yj > y && x < (xj - xi) * ((y - yi) / (yj - yi)) + xi;
          if (intersect) {
            inside = !inside;
          }
        }
        return inside;
      };
      Polygon2.prototype.toString = function() {
        return "[@pixi/math:Polygon" + ("closeStroke=" + this.closeStroke) + ("points=" + this.points.reduce(function(pointsDesc, currentPoint) {
          return pointsDesc + ", " + currentPoint;
        }, "") + "]");
      };
      return Polygon2;
    }()
  );
  var RoundedRectangle = (
    /** @class */
    function() {
      function RoundedRectangle2(x, y, width, height, radius) {
        if (x === void 0) {
          x = 0;
        }
        if (y === void 0) {
          y = 0;
        }
        if (width === void 0) {
          width = 0;
        }
        if (height === void 0) {
          height = 0;
        }
        if (radius === void 0) {
          radius = 20;
        }
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.radius = radius;
        this.type = SHAPES.RREC;
      }
      RoundedRectangle2.prototype.clone = function() {
        return new RoundedRectangle2(this.x, this.y, this.width, this.height, this.radius);
      };
      RoundedRectangle2.prototype.contains = function(x, y) {
        if (this.width <= 0 || this.height <= 0) {
          return false;
        }
        if (x >= this.x && x <= this.x + this.width) {
          if (y >= this.y && y <= this.y + this.height) {
            var radius = Math.max(0, Math.min(this.radius, Math.min(this.width, this.height) / 2));
            if (y >= this.y + radius && y <= this.y + this.height - radius || x >= this.x + radius && x <= this.x + this.width - radius) {
              return true;
            }
            var dx = x - (this.x + radius);
            var dy = y - (this.y + radius);
            var radius2 = radius * radius;
            if (dx * dx + dy * dy <= radius2) {
              return true;
            }
            dx = x - (this.x + this.width - radius);
            if (dx * dx + dy * dy <= radius2) {
              return true;
            }
            dy = y - (this.y + this.height - radius);
            if (dx * dx + dy * dy <= radius2) {
              return true;
            }
            dx = x - (this.x + radius);
            if (dx * dx + dy * dy <= radius2) {
              return true;
            }
          }
        }
        return false;
      };
      RoundedRectangle2.prototype.toString = function() {
        return "[@pixi/math:RoundedRectangle x=" + this.x + " y=" + this.y + ("width=" + this.width + " height=" + this.height + " radius=" + this.radius + "]");
      };
      return RoundedRectangle2;
    }()
  );
  var ObservablePoint = (
    /** @class */
    function() {
      function ObservablePoint2(cb, scope, x, y) {
        if (x === void 0) {
          x = 0;
        }
        if (y === void 0) {
          y = 0;
        }
        this._x = x;
        this._y = y;
        this.cb = cb;
        this.scope = scope;
      }
      ObservablePoint2.prototype.clone = function(cb, scope) {
        if (cb === void 0) {
          cb = this.cb;
        }
        if (scope === void 0) {
          scope = this.scope;
        }
        return new ObservablePoint2(cb, scope, this._x, this._y);
      };
      ObservablePoint2.prototype.set = function(x, y) {
        if (x === void 0) {
          x = 0;
        }
        if (y === void 0) {
          y = x;
        }
        if (this._x !== x || this._y !== y) {
          this._x = x;
          this._y = y;
          this.cb.call(this.scope);
        }
        return this;
      };
      ObservablePoint2.prototype.copyFrom = function(p) {
        if (this._x !== p.x || this._y !== p.y) {
          this._x = p.x;
          this._y = p.y;
          this.cb.call(this.scope);
        }
        return this;
      };
      ObservablePoint2.prototype.copyTo = function(p) {
        p.set(this._x, this._y);
        return p;
      };
      ObservablePoint2.prototype.equals = function(p) {
        return p.x === this._x && p.y === this._y;
      };
      ObservablePoint2.prototype.toString = function() {
        return "[@pixi/math:ObservablePoint x=0 y=0 scope=" + this.scope + "]";
      };
      Object.defineProperty(ObservablePoint2.prototype, "x", {
        /** Position of the observable point on the x axis. */
        get: function() {
          return this._x;
        },
        set: function(value) {
          if (this._x !== value) {
            this._x = value;
            this.cb.call(this.scope);
          }
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(ObservablePoint2.prototype, "y", {
        /** Position of the observable point on the y axis. */
        get: function() {
          return this._y;
        },
        set: function(value) {
          if (this._y !== value) {
            this._y = value;
            this.cb.call(this.scope);
          }
        },
        enumerable: false,
        configurable: true
      });
      return ObservablePoint2;
    }()
  );
  var Matrix = (
    /** @class */
    function() {
      function Matrix2(a, b, c, d, tx, ty) {
        if (a === void 0) {
          a = 1;
        }
        if (b === void 0) {
          b = 0;
        }
        if (c === void 0) {
          c = 0;
        }
        if (d === void 0) {
          d = 1;
        }
        if (tx === void 0) {
          tx = 0;
        }
        if (ty === void 0) {
          ty = 0;
        }
        this.array = null;
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.tx = tx;
        this.ty = ty;
      }
      Matrix2.prototype.fromArray = function(array) {
        this.a = array[0];
        this.b = array[1];
        this.c = array[3];
        this.d = array[4];
        this.tx = array[2];
        this.ty = array[5];
      };
      Matrix2.prototype.set = function(a, b, c, d, tx, ty) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.tx = tx;
        this.ty = ty;
        return this;
      };
      Matrix2.prototype.toArray = function(transpose, out) {
        if (!this.array) {
          this.array = new Float32Array(9);
        }
        var array = out || this.array;
        if (transpose) {
          array[0] = this.a;
          array[1] = this.b;
          array[2] = 0;
          array[3] = this.c;
          array[4] = this.d;
          array[5] = 0;
          array[6] = this.tx;
          array[7] = this.ty;
          array[8] = 1;
        } else {
          array[0] = this.a;
          array[1] = this.c;
          array[2] = this.tx;
          array[3] = this.b;
          array[4] = this.d;
          array[5] = this.ty;
          array[6] = 0;
          array[7] = 0;
          array[8] = 1;
        }
        return array;
      };
      Matrix2.prototype.apply = function(pos, newPos) {
        newPos = newPos || new Point();
        var x = pos.x;
        var y = pos.y;
        newPos.x = this.a * x + this.c * y + this.tx;
        newPos.y = this.b * x + this.d * y + this.ty;
        return newPos;
      };
      Matrix2.prototype.applyInverse = function(pos, newPos) {
        newPos = newPos || new Point();
        var id = 1 / (this.a * this.d + this.c * -this.b);
        var x = pos.x;
        var y = pos.y;
        newPos.x = this.d * id * x + -this.c * id * y + (this.ty * this.c - this.tx * this.d) * id;
        newPos.y = this.a * id * y + -this.b * id * x + (-this.ty * this.a + this.tx * this.b) * id;
        return newPos;
      };
      Matrix2.prototype.translate = function(x, y) {
        this.tx += x;
        this.ty += y;
        return this;
      };
      Matrix2.prototype.scale = function(x, y) {
        this.a *= x;
        this.d *= y;
        this.c *= x;
        this.b *= y;
        this.tx *= x;
        this.ty *= y;
        return this;
      };
      Matrix2.prototype.rotate = function(angle) {
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        var a1 = this.a;
        var c1 = this.c;
        var tx1 = this.tx;
        this.a = a1 * cos - this.b * sin;
        this.b = a1 * sin + this.b * cos;
        this.c = c1 * cos - this.d * sin;
        this.d = c1 * sin + this.d * cos;
        this.tx = tx1 * cos - this.ty * sin;
        this.ty = tx1 * sin + this.ty * cos;
        return this;
      };
      Matrix2.prototype.append = function(matrix) {
        var a1 = this.a;
        var b1 = this.b;
        var c1 = this.c;
        var d1 = this.d;
        this.a = matrix.a * a1 + matrix.b * c1;
        this.b = matrix.a * b1 + matrix.b * d1;
        this.c = matrix.c * a1 + matrix.d * c1;
        this.d = matrix.c * b1 + matrix.d * d1;
        this.tx = matrix.tx * a1 + matrix.ty * c1 + this.tx;
        this.ty = matrix.tx * b1 + matrix.ty * d1 + this.ty;
        return this;
      };
      Matrix2.prototype.setTransform = function(x, y, pivotX, pivotY, scaleX, scaleY, rotation, skewX, skewY) {
        this.a = Math.cos(rotation + skewY) * scaleX;
        this.b = Math.sin(rotation + skewY) * scaleX;
        this.c = -Math.sin(rotation - skewX) * scaleY;
        this.d = Math.cos(rotation - skewX) * scaleY;
        this.tx = x - (pivotX * this.a + pivotY * this.c);
        this.ty = y - (pivotX * this.b + pivotY * this.d);
        return this;
      };
      Matrix2.prototype.prepend = function(matrix) {
        var tx1 = this.tx;
        if (matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1) {
          var a1 = this.a;
          var c1 = this.c;
          this.a = a1 * matrix.a + this.b * matrix.c;
          this.b = a1 * matrix.b + this.b * matrix.d;
          this.c = c1 * matrix.a + this.d * matrix.c;
          this.d = c1 * matrix.b + this.d * matrix.d;
        }
        this.tx = tx1 * matrix.a + this.ty * matrix.c + matrix.tx;
        this.ty = tx1 * matrix.b + this.ty * matrix.d + matrix.ty;
        return this;
      };
      Matrix2.prototype.decompose = function(transform) {
        var a = this.a;
        var b = this.b;
        var c = this.c;
        var d = this.d;
        var pivot = transform.pivot;
        var skewX = -Math.atan2(-c, d);
        var skewY = Math.atan2(b, a);
        var delta = Math.abs(skewX + skewY);
        if (delta < 1e-5 || Math.abs(PI_2 - delta) < 1e-5) {
          transform.rotation = skewY;
          transform.skew.x = transform.skew.y = 0;
        } else {
          transform.rotation = 0;
          transform.skew.x = skewX;
          transform.skew.y = skewY;
        }
        transform.scale.x = Math.sqrt(a * a + b * b);
        transform.scale.y = Math.sqrt(c * c + d * d);
        transform.position.x = this.tx + (pivot.x * a + pivot.y * c);
        transform.position.y = this.ty + (pivot.x * b + pivot.y * d);
        return transform;
      };
      Matrix2.prototype.invert = function() {
        var a1 = this.a;
        var b1 = this.b;
        var c1 = this.c;
        var d1 = this.d;
        var tx1 = this.tx;
        var n = a1 * d1 - b1 * c1;
        this.a = d1 / n;
        this.b = -b1 / n;
        this.c = -c1 / n;
        this.d = a1 / n;
        this.tx = (c1 * this.ty - d1 * tx1) / n;
        this.ty = -(a1 * this.ty - b1 * tx1) / n;
        return this;
      };
      Matrix2.prototype.identity = function() {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.tx = 0;
        this.ty = 0;
        return this;
      };
      Matrix2.prototype.clone = function() {
        var matrix = new Matrix2();
        matrix.a = this.a;
        matrix.b = this.b;
        matrix.c = this.c;
        matrix.d = this.d;
        matrix.tx = this.tx;
        matrix.ty = this.ty;
        return matrix;
      };
      Matrix2.prototype.copyTo = function(matrix) {
        matrix.a = this.a;
        matrix.b = this.b;
        matrix.c = this.c;
        matrix.d = this.d;
        matrix.tx = this.tx;
        matrix.ty = this.ty;
        return matrix;
      };
      Matrix2.prototype.copyFrom = function(matrix) {
        this.a = matrix.a;
        this.b = matrix.b;
        this.c = matrix.c;
        this.d = matrix.d;
        this.tx = matrix.tx;
        this.ty = matrix.ty;
        return this;
      };
      Matrix2.prototype.toString = function() {
        return "[@pixi/math:Matrix a=" + this.a + " b=" + this.b + " c=" + this.c + " d=" + this.d + " tx=" + this.tx + " ty=" + this.ty + "]";
      };
      Object.defineProperty(Matrix2, "IDENTITY", {
        /**
         * A default (identity) matrix
         * @readonly
         */
        get: function() {
          return new Matrix2();
        },
        enumerable: false,
        configurable: true
      });
      Object.defineProperty(Matrix2, "TEMP_MATRIX", {
        /**
         * A temp matrix
         * @readonly
         */
        get: function() {
          return new Matrix2();
        },
        enumerable: false,
        configurable: true
      });
      return Matrix2;
    }()
  );
  var ux = [1, 1, 0, -1, -1, -1, 0, 1, 1, 1, 0, -1, -1, -1, 0, 1];
  var uy = [0, 1, 1, 1, 0, -1, -1, -1, 0, 1, 1, 1, 0, -1, -1, -1];
  var vx = [0, -1, -1, -1, 0, 1, 1, 1, 0, 1, 1, 1, 0, -1, -1, -1];
  var vy = [1, 1, 0, -1, -1, -1, 0, 1, -1, -1, 0, 1, 1, 1, 0, -1];
  var rotationCayley = [];
  var rotationMatrices = [];
  var signum = Math.sign;
  function init() {
    for (var i = 0; i < 16; i++) {
      var row = [];
      rotationCayley.push(row);
      for (var j = 0; j < 16; j++) {
        var _ux = signum(ux[i] * ux[j] + vx[i] * uy[j]);
        var _uy = signum(uy[i] * ux[j] + vy[i] * uy[j]);
        var _vx = signum(ux[i] * vx[j] + vx[i] * vy[j]);
        var _vy = signum(uy[i] * vx[j] + vy[i] * vy[j]);
        for (var k = 0; k < 16; k++) {
          if (ux[k] === _ux && uy[k] === _uy && vx[k] === _vx && vy[k] === _vy) {
            row.push(k);
            break;
          }
        }
      }
    }
    for (var i = 0; i < 16; i++) {
      var mat = new Matrix();
      mat.set(ux[i], uy[i], vx[i], vy[i], 0, 0);
      rotationMatrices.push(mat);
    }
  }
  init();
  var Transform = (
    /** @class */
    function() {
      function Transform2() {
        this.worldTransform = new Matrix();
        this.localTransform = new Matrix();
        this.position = new ObservablePoint(this.onChange, this, 0, 0);
        this.scale = new ObservablePoint(this.onChange, this, 1, 1);
        this.pivot = new ObservablePoint(this.onChange, this, 0, 0);
        this.skew = new ObservablePoint(this.updateSkew, this, 0, 0);
        this._rotation = 0;
        this._cx = 1;
        this._sx = 0;
        this._cy = 0;
        this._sy = 1;
        this._localID = 0;
        this._currentLocalID = 0;
        this._worldID = 0;
        this._parentID = 0;
      }
      Transform2.prototype.onChange = function() {
        this._localID++;
      };
      Transform2.prototype.updateSkew = function() {
        this._cx = Math.cos(this._rotation + this.skew.y);
        this._sx = Math.sin(this._rotation + this.skew.y);
        this._cy = -Math.sin(this._rotation - this.skew.x);
        this._sy = Math.cos(this._rotation - this.skew.x);
        this._localID++;
      };
      Transform2.prototype.toString = function() {
        return "[@pixi/math:Transform " + ("position=(" + this.position.x + ", " + this.position.y + ") ") + ("rotation=" + this.rotation + " ") + ("scale=(" + this.scale.x + ", " + this.scale.y + ") ") + ("skew=(" + this.skew.x + ", " + this.skew.y + ") ") + "]";
      };
      Transform2.prototype.updateLocalTransform = function() {
        var lt = this.localTransform;
        if (this._localID !== this._currentLocalID) {
          lt.a = this._cx * this.scale.x;
          lt.b = this._sx * this.scale.x;
          lt.c = this._cy * this.scale.y;
          lt.d = this._sy * this.scale.y;
          lt.tx = this.position.x - (this.pivot.x * lt.a + this.pivot.y * lt.c);
          lt.ty = this.position.y - (this.pivot.x * lt.b + this.pivot.y * lt.d);
          this._currentLocalID = this._localID;
          this._parentID = -1;
        }
      };
      Transform2.prototype.updateTransform = function(parentTransform) {
        var lt = this.localTransform;
        if (this._localID !== this._currentLocalID) {
          lt.a = this._cx * this.scale.x;
          lt.b = this._sx * this.scale.x;
          lt.c = this._cy * this.scale.y;
          lt.d = this._sy * this.scale.y;
          lt.tx = this.position.x - (this.pivot.x * lt.a + this.pivot.y * lt.c);
          lt.ty = this.position.y - (this.pivot.x * lt.b + this.pivot.y * lt.d);
          this._currentLocalID = this._localID;
          this._parentID = -1;
        }
        if (this._parentID !== parentTransform._worldID) {
          var pt = parentTransform.worldTransform;
          var wt = this.worldTransform;
          wt.a = lt.a * pt.a + lt.b * pt.c;
          wt.b = lt.a * pt.b + lt.b * pt.d;
          wt.c = lt.c * pt.a + lt.d * pt.c;
          wt.d = lt.c * pt.b + lt.d * pt.d;
          wt.tx = lt.tx * pt.a + lt.ty * pt.c + pt.tx;
          wt.ty = lt.tx * pt.b + lt.ty * pt.d + pt.ty;
          this._parentID = parentTransform._worldID;
          this._worldID++;
        }
      };
      Transform2.prototype.setFromMatrix = function(matrix) {
        matrix.decompose(this);
        this._localID++;
      };
      Object.defineProperty(Transform2.prototype, "rotation", {
        /** The rotation of the object in radians. */
        get: function() {
          return this._rotation;
        },
        set: function(value) {
          if (this._rotation !== value) {
            this._rotation = value;
            this.updateSkew();
          }
        },
        enumerable: false,
        configurable: true
      });
      Transform2.IDENTITY = new Transform2();
      return Transform2;
    }()
  );

  // node_modules/@nitrots/nitro-renderer/src/api/room/Vector3d.ts
  var Vector3d = class _Vector3d {
    _x;
    _y;
    _z;
    _length;
    constructor(x = 0, y = 0, z = 0) {
      this._x = x;
      this._y = y;
      this._z = z;
      this._length = NaN;
    }
    static sum(vector1, vector2) {
      if (!vector1 || !vector2) return null;
      return new _Vector3d(vector1.x + vector2.x, vector1.y + vector2.y, vector1.z + vector2.z);
    }
    static dif(vector1, vector2) {
      if (!vector1 || !vector2) return null;
      return new _Vector3d(vector1.x - vector2.x, vector1.y - vector2.y, vector1.z - vector2.z);
    }
    static product(vector, value) {
      if (!vector) return null;
      return new _Vector3d(vector.x * value, vector.y * value, vector.z * value);
    }
    static dotProduct(vector1, vector2) {
      if (!vector1 || !vector2) return 0;
      return vector1.x * vector2.x + vector1.y * vector2.y + vector1.z * vector2.z;
    }
    static crossProduct(vector1, vector2) {
      if (!vector1 || !vector2) return null;
      return new _Vector3d(vector1.y * vector2.z - vector1.z * vector2.y, vector1.z * vector2.x - vector1.x * vector2.z, vector1.x * vector2.y - vector1.y * vector2.x);
    }
    static scalarProjection(vector1, vector2) {
      if (!vector1 || !vector2) return -1;
      const length = vector2.length;
      if (length > 0) {
        return (vector1.x * vector2.x + vector1.y * vector2.y + vector1.z * vector2.z) / length;
      }
      return -1;
    }
    static cosAngle(vector1, vector2) {
      if (!vector1 || !vector2) return 0;
      const totalLength = vector1.length * vector2.length;
      if (!totalLength) return 0;
      return _Vector3d.dotProduct(vector1, vector2) / totalLength;
    }
    static isEqual(vector1, vector2) {
      if (!vector1 || !vector2) return false;
      if (vector1.x !== vector2.x || vector1.y !== vector2.y || vector1.z !== vector2.z) return false;
      return true;
    }
    negate() {
      this._x = -this._x;
      this._y = -this._y;
      this._z = -this._z;
    }
    add(vector) {
      if (!vector) return;
      this._x += vector.x;
      this._y += vector.y;
      this._z += vector.z;
      this._length = NaN;
    }
    subtract(vector) {
      if (!vector) return;
      this._x -= vector.x;
      this._y -= vector.y;
      this._z -= vector.z;
      this._length = NaN;
    }
    multiply(amount) {
      this._x *= amount;
      this._y *= amount;
      this._z *= amount;
      this._length = NaN;
    }
    divide(amount) {
      if (!amount) return;
      this._x /= amount;
      this._y /= amount;
      this._z /= amount;
      this._length = NaN;
    }
    assign(vector) {
      if (!vector) return;
      this._x = vector.x;
      this._y = vector.y;
      this._z = vector.z;
      this._length = NaN;
    }
    get x() {
      return this._x;
    }
    set x(k) {
      this._x = k;
      this._length = NaN;
    }
    get y() {
      return this._y;
    }
    set y(k) {
      this._y = k;
      this._length = NaN;
    }
    get z() {
      return this._z;
    }
    set z(k) {
      this._z = k;
      this._length = NaN;
    }
    get length() {
      if (isNaN(this._length)) {
        this._length = Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z);
      }
      return this._length;
    }
    toString() {
      return `[Vector3d: ${this._x}, ${this._y}, ${this._z}]`;
    }
  };

  // node_modules/@nitrots/nitro-renderer/src/nitro/room/object/RoomFloorHole.ts
  var RoomFloorHole = class {
    _x;
    _y;
    _width;
    _height;
    constructor(x, y, width, height) {
      this._x = x;
      this._y = y;
      this._width = width;
      this._height = height;
    }
    get x() {
      return this._x;
    }
    get y() {
      return this._y;
    }
    get width() {
      return this._width;
    }
    get height() {
      return this._height;
    }
  };

  // node_modules/@nitrots/nitro-renderer/src/nitro/room/object/RoomMapData.ts
  var RoomMapData = class {
    _width;
    _height;
    _wallHeight;
    _fixedWallsHeight;
    _tileMap;
    _holeMap;
    _doors;
    _dimensions;
    _restrictsDragging;
    _restrictsScaling;
    _restrictedScale;
    constructor() {
      this._width = 0;
      this._height = 0;
      this._wallHeight = 0;
      this._fixedWallsHeight = 0;
      this._tileMap = [];
      this._holeMap = [];
      this._doors = [];
      this._dimensions = {
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0
      };
      this._restrictsDragging = false;
      this._restrictedScale = 1;
      this._restrictsScaling = false;
    }
    get width() {
      return this._width;
    }
    set width(width) {
      this._width = width;
    }
    get height() {
      return this._height;
    }
    set height(height) {
      this._height = height;
    }
    get wallHeight() {
      return this._wallHeight;
    }
    set wallHeight(wallHeight) {
      this._wallHeight = wallHeight;
    }
    get fixedWallsHeight() {
      return this._fixedWallsHeight;
    }
    set fixedWallsHeight(fixedWallsHeight) {
      this._fixedWallsHeight = fixedWallsHeight;
    }
    get tileMap() {
      return this._tileMap;
    }
    get holeMap() {
      return this._holeMap;
    }
    get doors() {
      return this._doors;
    }
    get dimensions() {
      return this._dimensions;
    }
    get restrictsDragging() {
      return this._restrictsDragging;
    }
    set restrictsDragging(flag) {
      this._restrictsDragging = flag;
    }
    get restrictsScaling() {
      return this._restrictsScaling;
    }
    set restrictsScaling(flag) {
      this._restrictsScaling = flag;
    }
    get restrictedScale() {
      return this._restrictedScale;
    }
    set restrictedScale(scale) {
      this._restrictedScale = scale;
    }
  };

  // node_modules/@nitrots/nitro-renderer/src/nitro/room/object/RoomPlaneMaskData.ts
  var RoomPlaneMaskData = class {
    _leftSideLoc = 0;
    _rightSideLoc = 0;
    _leftSideLength = 0;
    _rightSideLength = 0;
    constructor(k, _arg_2, _arg_3, _arg_4) {
      this._leftSideLoc = k;
      this._rightSideLoc = _arg_2;
      this._leftSideLength = _arg_3;
      this._rightSideLength = _arg_4;
    }
    get leftSideLoc() {
      return this._leftSideLoc;
    }
    get rightSideLoc() {
      return this._rightSideLoc;
    }
    get leftSideLength() {
      return this._leftSideLength;
    }
    get rightSideLength() {
      return this._rightSideLength;
    }
  };

  // node_modules/@nitrots/nitro-renderer/src/nitro/room/object/RoomPlaneData.ts
  var RoomPlaneData = class {
    static PLANE_UNDEFINED = 0;
    static PLANE_FLOOR = 1;
    static PLANE_WALL = 2;
    static PLANE_LANDSCAPE = 3;
    static PLANE_BILLBOARD = 4;
    _type = 0;
    _loc = null;
    _leftSide = null;
    _rightSide = null;
    _normal = null;
    _normalDirection = null;
    _secondaryNormals;
    _masks;
    constructor(k, _arg_2, _arg_3, _arg_4, _arg_5) {
      let _local_6;
      let _local_7;
      let _local_8;
      let _local_9;
      let _local_10;
      let _local_11;
      let _local_12;
      let _local_13;
      this._secondaryNormals = [];
      this._masks = [];
      this._loc = new Vector3d();
      this._loc.assign(_arg_2);
      this._leftSide = new Vector3d();
      this._leftSide.assign(_arg_3);
      this._rightSide = new Vector3d();
      this._rightSide.assign(_arg_4);
      this._type = k;
      if (!(_arg_3 == null) && !(_arg_4 == null)) {
        this._normal = Vector3d.crossProduct(_arg_3, _arg_4);
        _local_6 = 0;
        _local_7 = 0;
        _local_8 = 0;
        _local_9 = 0;
        _local_10 = 0;
        if (!(this.normal.x == 0) || !(this.normal.y == 0)) {
          _local_9 = this.normal.x;
          _local_10 = this.normal.y;
          _local_6 = 360 + Math.atan2(_local_10, _local_9) / Math.PI * 180;
          if (_local_6 >= 360) {
            _local_6 = _local_6 - 360;
          }
          _local_9 = Math.sqrt(this.normal.x * this.normal.x + this.normal.y * this.normal.y);
          _local_10 = this.normal.z;
          _local_7 = 360 + Math.atan2(_local_10, _local_9) / Math.PI * 180;
          if (_local_7 >= 360) {
            _local_7 = _local_7 - 360;
          }
        } else {
          if (this.normal.z < 0) {
            _local_7 = 90;
          } else {
            _local_7 = 270;
          }
        }
        this._normalDirection = new Vector3d(_local_6, _local_7, _local_8);
      }
      if (!(_arg_5 == null) && _arg_5.length > 0) {
        _local_11 = 0;
        while (_local_11 < _arg_5.length) {
          _local_12 = _arg_5[_local_11];
          if (!(_local_12 == null) && _local_12.length > 0) {
            _local_13 = new Vector3d();
            _local_13.assign(_local_12);
            _local_13.multiply(1 / _local_13.length);
            this._secondaryNormals.push(_local_13);
          }
          _local_11++;
        }
      }
    }
    get type() {
      return this._type;
    }
    get loc() {
      return this._loc;
    }
    get leftSide() {
      return this._leftSide;
    }
    get rightSide() {
      return this._rightSide;
    }
    get normal() {
      return this._normal;
    }
    get normalDirection() {
      return this._normalDirection;
    }
    get secondaryNormalCount() {
      return this._secondaryNormals.length;
    }
    get maskCount() {
      return this._masks.length;
    }
    getSecondaryNormal(k) {
      if (k < 0 || k >= this.secondaryNormalCount) {
        return null;
      }
      const _local_2 = new Vector3d();
      _local_2.assign(this._secondaryNormals[k]);
      return _local_2;
    }
    addMask(k, _arg_2, _arg_3, _arg_4) {
      const _local_5 = new RoomPlaneMaskData(k, _arg_2, _arg_3, _arg_4);
      this._masks.push(_local_5);
    }
    getMask(k) {
      if (k < 0 || k >= this.maskCount) {
        return null;
      }
      return this._masks[k];
    }
    getMaskLeftSideLoc(k) {
      const _local_2 = this.getMask(k);
      if (_local_2 != null) {
        return _local_2.leftSideLoc;
      }
      return -1;
    }
    getMaskRightSideLoc(k) {
      const _local_2 = this.getMask(k);
      if (_local_2 != null) {
        return _local_2.rightSideLoc;
      }
      return -1;
    }
    getMaskLeftSideLength(k) {
      const _local_2 = this.getMask(k);
      if (_local_2 != null) {
        return _local_2.leftSideLength;
      }
      return -1;
    }
    getMaskRightSideLength(k) {
      const _local_2 = this.getMask(k);
      if (_local_2 != null) {
        return _local_2.rightSideLength;
      }
      return -1;
    }
  };

  // node_modules/@nitrots/nitro-renderer/src/nitro/room/object/RoomWallData.ts
  var RoomWallData = class _RoomWallData {
    static WALL_DIRECTION_VECTORS = [
      new Vector3d(1, 0, 0),
      new Vector3d(0, 1, 0),
      new Vector3d(-1, 0, 0),
      new Vector3d(0, -1, 0)
    ];
    static WALL_NORMAL_VECTORS = [
      new Vector3d(0, 1, 0),
      new Vector3d(-1, 0, 0),
      new Vector3d(0, -1, 0),
      new Vector3d(1, 0, 0)
    ];
    _corners;
    _endPoints;
    _directions;
    _lengths;
    _leftTurns;
    _borders;
    _hideWalls;
    _manuallyLeftCut;
    _manuallyRightCut;
    _addDuplicates;
    _count;
    constructor() {
      this._corners = [];
      this._endPoints = [];
      this._directions = [];
      this._lengths = [];
      this._leftTurns = [];
      this._borders = [];
      this._hideWalls = [];
      this._manuallyLeftCut = [];
      this._manuallyRightCut = [];
      this._addDuplicates = false;
      this._count = 0;
    }
    addWall(k, _arg_2, _arg_3, _arg_4, _arg_5) {
      if (this._addDuplicates || this.checkIsNotDuplicate(k, _arg_2, _arg_3, _arg_4, _arg_5)) {
        this._corners.push(k);
        this._directions.push(_arg_2);
        this._lengths.push(_arg_3);
        this._borders.push(_arg_4);
        this._leftTurns.push(_arg_5);
        this._hideWalls.push(false);
        this._manuallyLeftCut.push(false);
        this._manuallyRightCut.push(false);
        this._count++;
      }
    }
    checkIsNotDuplicate(k, _arg_2, _arg_3, _arg_4, _arg_5) {
      let _local_6 = 0;
      while (_local_6 < this._count) {
        if (this._corners[_local_6].x == k.x && this._corners[_local_6].y == k.y && this._directions[_local_6] == _arg_2 && this._lengths[_local_6] == _arg_3 && this._borders[_local_6] == _arg_4 && this._leftTurns[_local_6] == _arg_5) {
          return false;
        }
        _local_6++;
      }
      return true;
    }
    get count() {
      return this._count;
    }
    getCorner(k) {
      return this._corners[k];
    }
    getEndPoint(k) {
      this.calculateWallEndPoints();
      return this._endPoints[k];
    }
    getLength(k) {
      return this._lengths[k];
    }
    getDirection(k) {
      return this._directions[k];
    }
    getBorder(k) {
      return this._borders[k];
    }
    getHideWall(k) {
      return this._hideWalls[k];
    }
    getLeftTurn(k) {
      return this._leftTurns[k];
    }
    getManuallyLeftCut(k) {
      return this._manuallyLeftCut[k];
    }
    getManuallyRightCut(k) {
      return this._manuallyRightCut[k];
    }
    setHideWall(k, _arg_2) {
      this._hideWalls[k] = _arg_2;
    }
    setLength(k, _arg_2) {
      if (_arg_2 < this._lengths[k]) {
        this._lengths[k] = _arg_2;
        this._manuallyRightCut[k] = true;
      }
    }
    moveCorner(k, _arg_2) {
      let _local_3;
      if (_arg_2 > 0 && _arg_2 < this._lengths[k]) {
        const corner = this._corners[k];
        _local_3 = _RoomWallData.WALL_DIRECTION_VECTORS[this.getDirection(k)];
        this._corners[k] = new Point(corner.x + _arg_2 * _local_3.x, corner.y + _arg_2 * _local_3.y);
        this._lengths[k] = this._lengths[k] - _arg_2;
        this._manuallyLeftCut[k] = true;
      }
    }
    calculateWallEndPoints() {
      let k;
      let _local_2;
      let _local_3;
      let _local_4;
      let _local_5;
      if (this._endPoints.length != this.count) {
        this._endPoints = [];
        k = 0;
        while (k < this.count) {
          _local_2 = this.getCorner(k);
          _local_3 = new Point(_local_2.x, _local_2.y);
          _local_4 = _RoomWallData.WALL_DIRECTION_VECTORS[this.getDirection(k)];
          _local_5 = this.getLength(k);
          _local_3.x = _local_3.x + _local_4.x * _local_5;
          _local_3.y = _local_3.y + _local_4.y * _local_5;
          this._endPoints.push(_local_3);
          k++;
        }
      }
    }
  };

  // node_modules/@nitrots/nitro-renderer/src/nitro/room/object/RoomPlaneParser.ts
  var RoomPlaneParser = class _RoomPlaneParser {
    static FLOOR_THICKNESS = 0.25;
    static WALL_THICKNESS = 0.25;
    static MAX_WALL_ADDITIONAL_HEIGHT = 20;
    static TILE_BLOCKED = -110;
    static TILE_HOLE = -100;
    _tileMatrix;
    _tileMatrixOriginal;
    _width = 0;
    _height = 0;
    _minX = 0;
    _maxX = 0;
    _minY = 0;
    _maxY = 0;
    _planes;
    _wallHeight;
    _wallThicknessMultiplier;
    _floorThicknessMultiplier;
    _fixedWallHeight = -1;
    _floorHeight = 0;
    _floorHoles;
    _floorHoleMatrix;
    _restrictsDragging;
    _restrictsScaling = false;
    _restrictedScale = 1;
    constructor() {
      this._tileMatrix = [];
      this._tileMatrixOriginal = [];
      this._planes = [];
      this._floorHoleMatrix = [];
      this._wallHeight = 3.6;
      this._wallThicknessMultiplier = 1;
      this._floorThicknessMultiplier = 1;
      this._floorHoles = /* @__PURE__ */ new Map();
    }
    static getFloorHeight(matricies) {
      const length = matricies.length;
      if (!length) return 0;
      let tileHeight = 0;
      let i = 0;
      while (i < length) {
        const matrix = matricies[i];
        let j = 0;
        while (j < matrix.length) {
          const height = matrix[j];
          if (height > tileHeight) tileHeight = height;
          j++;
        }
        i++;
      }
      return tileHeight;
    }
    static findEntranceTile(matricies) {
      if (!matricies) return null;
      const length = matricies.length;
      if (!length) return null;
      const _local_6 = [];
      let i = 0;
      while (i < length) {
        const matrix = matricies[i];
        if (!matrix || !matrix.length) return null;
        let j = 0;
        while (j < matrix.length) {
          if (matrix[j] >= 0) {
            _local_6.push(j);
            break;
          }
          j++;
        }
        if (_local_6.length < i + 1) _local_6.push(matrix.length + 1);
        i++;
      }
      i = 1;
      while (i < _local_6.length - 1) {
        if (Math.trunc(_local_6[i]) <= Math.trunc(_local_6[i - 1]) - 1 && Math.trunc(_local_6[i]) <= Math.trunc(_local_6[i + 1]) - 1) return new Point(Math.trunc(_local_6[i] | 0), i);
        i++;
      }
      return null;
    }
    static expandFloorTiles(k) {
      let _local_5;
      let _local_6;
      let _local_7;
      let _local_8;
      let _local_10;
      let _local_11;
      let _local_12;
      let _local_13;
      let _local_14;
      let _local_15;
      let _local_16;
      let _local_17;
      const _local_2 = k.length;
      const _local_3 = k[0].length;
      const _local_4 = [];
      _local_6 = 0;
      while (_local_6 < _local_2 * 4) {
        _local_4[_local_6] = [];
        _local_6++;
      }
      let _local_9 = 0;
      _local_6 = 0;
      while (_local_6 < _local_2) {
        _local_10 = 0;
        _local_5 = 0;
        while (_local_5 < _local_3) {
          _local_11 = k[_local_6][_local_5];
          if (_local_11 < 0 || _local_11 <= 255) {
            _local_8 = 0;
            while (_local_8 < 4) {
              _local_7 = 0;
              while (_local_7 < 4) {
                if (_local_4[_local_9 + _local_8] === void 0) _local_4[_local_9 + _local_8] = [];
                _local_4[_local_9 + _local_8][_local_10 + _local_7] = _local_11 < 0 ? _local_11 : _local_11 * 4;
                _local_7++;
              }
              _local_8++;
            }
          } else {
            _local_12 = (_local_11 & 255) * 4;
            _local_13 = _local_12 + (_local_11 >> 11 & 1) * 3;
            _local_14 = _local_12 + (_local_11 >> 10 & 1) * 3;
            _local_15 = _local_12 + (_local_11 >> 9 & 1) * 3;
            _local_16 = _local_12 + (_local_11 >> 8 & 1) * 3;
            _local_7 = 0;
            while (_local_7 < 3) {
              _local_17 = _local_7 + 1;
              _local_4[_local_9][_local_10 + _local_7] = (_local_13 * (3 - _local_7) + _local_14 * _local_7) / 3;
              _local_4[_local_9 + 3][_local_10 + _local_17] = (_local_15 * (3 - _local_17) + _local_16 * _local_17) / 3;
              _local_4[_local_9 + _local_17][_local_10] = (_local_13 * (3 - _local_17) + _local_15 * _local_17) / 3;
              _local_4[_local_9 + _local_7][_local_10 + 3] = (_local_14 * (3 - _local_7) + _local_16 * _local_7) / 3;
              _local_7++;
            }
            _local_4[_local_9 + 1][_local_10 + 1] = _local_13 > _local_12 ? _local_12 + 2 : _local_12 + 1;
            _local_4[_local_9 + 1][_local_10 + 2] = _local_14 > _local_12 ? _local_12 + 2 : _local_12 + 1;
            _local_4[_local_9 + 2][_local_10 + 1] = _local_15 > _local_12 ? _local_12 + 2 : _local_12 + 1;
            _local_4[_local_9 + 2][_local_10 + 2] = _local_16 > _local_12 ? _local_12 + 2 : _local_12 + 1;
          }
          _local_10 = _local_10 + 4;
          _local_5++;
        }
        _local_9 = _local_9 + 4;
        _local_6++;
      }
      return _local_4;
    }
    static addTileTypes(k) {
      let _local_4;
      let _local_5;
      let _local_6;
      let _local_7;
      let _local_8;
      let _local_9;
      let _local_10;
      let _local_11;
      let _local_12;
      let _local_13;
      let _local_14;
      let _local_15;
      let _local_16;
      let _local_17;
      const _local_2 = k.length - 1;
      const _local_3 = k[0].length - 1;
      _local_5 = 1;
      while (_local_5 < _local_2) {
        _local_4 = 1;
        while (_local_4 < _local_3) {
          _local_6 = k[_local_5][_local_4];
          if (_local_6 < 0) {
          } else {
            _local_7 = k[_local_5 - 1][_local_4 - 1] & 255;
            _local_8 = k[_local_5 - 1][_local_4] & 255;
            _local_9 = k[_local_5 - 1][_local_4 + 1] & 255;
            _local_10 = k[_local_5][_local_4 - 1] & 255;
            _local_11 = k[_local_5][_local_4 + 1] & 255;
            _local_12 = k[_local_5 + 1][_local_4 - 1] & 255;
            _local_13 = k[_local_5 + 1][_local_4] & 255;
            _local_14 = k[_local_5 + 1][_local_4 + 1] & 255;
            _local_15 = _local_6 + 1;
            _local_16 = _local_6 - 1;
            _local_17 = (_local_7 == _local_15 || _local_8 == _local_15 || _local_10 == _local_15 ? 8 : 0) | (_local_9 == _local_15 || _local_8 == _local_15 || _local_11 == _local_15 ? 4 : 0) | (_local_12 == _local_15 || _local_13 == _local_15 || _local_10 == _local_15 ? 2 : 0) | (_local_14 == _local_15 || _local_13 == _local_15 || _local_11 == _local_15 ? 1 : 0);
            if (_local_17 == 15) {
              _local_17 = 0;
            }
            k[_local_5][_local_4] = _local_6 | _local_17 << 8;
          }
          _local_4++;
        }
        _local_5++;
      }
    }
    static unpadHeightMap(k) {
      k.shift();
      k.pop();
      for (const _local_2 of k) {
        _local_2.shift();
        _local_2.pop();
      }
    }
    static padHeightMap(k) {
      const _local_2 = [];
      const _local_3 = [];
      for (const _local_4 of k) {
        _local_4.push(_RoomPlaneParser.TILE_BLOCKED);
        _local_4.unshift(_RoomPlaneParser.TILE_BLOCKED);
      }
      for (const _local_5 of k[0]) {
        _local_2.push(_RoomPlaneParser.TILE_BLOCKED);
        _local_3.push(_RoomPlaneParser.TILE_BLOCKED);
      }
      k.push(_local_3);
      k.unshift(_local_2);
    }
    get minX() {
      return this._minX;
    }
    get maxX() {
      return this._maxX;
    }
    get minY() {
      return this._minY;
    }
    get maxY() {
      return this._maxY;
    }
    get tileMapWidth() {
      return this._width;
    }
    get tileMapHeight() {
      return this._height;
    }
    get planeCount() {
      return this._planes.length;
    }
    get floorHeight() {
      if (this._fixedWallHeight != -1) {
        return this._fixedWallHeight;
      }
      return this._floorHeight;
    }
    get wallHeight() {
      if (this._fixedWallHeight != -1) {
        return this._fixedWallHeight + 3.6;
      }
      return this._wallHeight;
    }
    set wallHeight(k) {
      if (k < 0) {
        k = 0;
      }
      this._wallHeight = k;
    }
    get wallThicknessMultiplier() {
      return this._wallThicknessMultiplier;
    }
    set wallThicknessMultiplier(k) {
      if (k < 0) {
        k = 0;
      }
      this._wallThicknessMultiplier = k;
    }
    get floorThicknessMultiplier() {
      return this._floorThicknessMultiplier;
    }
    set floorThicknessMultiplier(k) {
      if (k < 0) {
        k = 0;
      }
      this._floorThicknessMultiplier = k;
    }
    dispose() {
      this._planes = null;
      this._tileMatrix = null;
      this._tileMatrixOriginal = null;
      this._floorHoleMatrix = null;
      if (this._floorHoles != null) {
        this._floorHoles.clear();
        this._floorHoles = null;
      }
    }
    reset() {
      this._planes = [];
      this._tileMatrix = [];
      this._tileMatrixOriginal = [];
      this._width = 0;
      this._height = 0;
      this._minX = 0;
      this._maxX = 0;
      this._minY = 0;
      this._maxY = 0;
      this._floorHeight = 0;
      this._floorHoleMatrix = [];
    }
    initializeTileMap(width, height) {
      if (width < 0) width = 0;
      if (height < 0) height = 0;
      this._tileMatrix = [];
      this._tileMatrixOriginal = [];
      this._floorHoleMatrix = [];
      let y = 0;
      while (y < height) {
        const tileMatrix = [];
        const tileMatrixOriginal = [];
        const floorHoleMatrix = [];
        let x = 0;
        while (x < width) {
          tileMatrix[x] = _RoomPlaneParser.TILE_BLOCKED;
          tileMatrixOriginal[x] = _RoomPlaneParser.TILE_BLOCKED;
          floorHoleMatrix[x] = false;
          x++;
        }
        this._tileMatrix.push(tileMatrix);
        this._tileMatrixOriginal.push(tileMatrixOriginal);
        this._floorHoleMatrix.push(floorHoleMatrix);
        y++;
      }
      this._width = width;
      this._height = height;
      this._minX = this._width;
      this._maxX = -1;
      this._minY = this._height;
      this._maxY = -1;
      return true;
    }
    setTileHeight(k, _arg_2, _arg_3) {
      let _local_4;
      let _local_5;
      let _local_6;
      let _local_7;
      let _local_8;
      if (k >= 0 && k < this._width && _arg_2 >= 0 && _arg_2 < this._height) {
        _local_4 = this._tileMatrix[_arg_2];
        _local_4[k] = _arg_3;
        if (_arg_3 >= 0) {
          if (k < this._minX) {
            this._minX = k;
          }
          if (k > this._maxX) {
            this._maxX = k;
          }
          if (_arg_2 < this._minY) {
            this._minY = _arg_2;
          }
          if (_arg_2 > this._maxY) {
            this._maxY = _arg_2;
          }
        } else {
          if (k == this._minX || k == this._maxX) {
            _local_5 = false;
            _local_6 = this._minY;
            while (_local_6 < this._maxY) {
              if (this.getTileHeightInternal(k, _local_6) >= 0) {
                _local_5 = true;
                break;
              }
              _local_6++;
            }
            if (!_local_5) {
              if (k == this._minX) {
                this._minX++;
              }
              if (k == this._maxX) {
                this._maxX--;
              }
            }
          }
          if (_arg_2 == this._minY || _arg_2 == this._maxY) {
            _local_7 = false;
            _local_8 = this._minX;
            while (_local_8 < this._maxX) {
              if (this.getTileHeight(_local_8, _arg_2) >= 0) {
                _local_7 = true;
                break;
              }
              _local_8++;
            }
            if (!_local_7) {
              if (_arg_2 == this._minY) {
                this._minY++;
              }
              if (_arg_2 == this._maxY) {
                this._maxY--;
              }
            }
          }
        }
        return true;
      }
      return false;
    }
    getTileHeight(k, _arg_2) {
      if (k < 0 || k >= this._width || _arg_2 < 0 || _arg_2 >= this._height) {
        return _RoomPlaneParser.TILE_BLOCKED;
      }
      const _local_3 = this._tileMatrix[_arg_2];
      if (_local_3[k] === void 0) return 0;
      return Math.abs(_local_3[k]);
    }
    getTileHeightOriginal(k, _arg_2) {
      if (k < 0 || k >= this._width || _arg_2 < 0 || _arg_2 >= this._height) {
        return _RoomPlaneParser.TILE_BLOCKED;
      }
      if (this._floorHoleMatrix[_arg_2][k]) {
        return _RoomPlaneParser.TILE_HOLE;
      }
      const _local_3 = this._tileMatrixOriginal[_arg_2];
      return _local_3[k];
    }
    getTileHeightInternal(k, _arg_2) {
      if (k < 0 || k >= this._width || _arg_2 < 0 || _arg_2 >= this._height) {
        return _RoomPlaneParser.TILE_BLOCKED;
      }
      const _local_3 = this._tileMatrix[_arg_2];
      return _local_3[k];
    }
    initializeFromTileData(k = -1) {
      let _local_2;
      let _local_3;
      this._fixedWallHeight = k;
      _local_3 = 0;
      while (_local_3 < this._height) {
        _local_2 = 0;
        while (_local_2 < this._width) {
          if (this._tileMatrixOriginal[_local_3] === void 0) this._tileMatrixOriginal[_local_3] = [];
          this._tileMatrixOriginal[_local_3][_local_2] = this._tileMatrix[_local_3][_local_2];
          _local_2++;
        }
        _local_3++;
      }
      const _local_4 = _RoomPlaneParser.findEntranceTile(this._tileMatrix);
      _local_3 = 0;
      while (_local_3 < this._height) {
        _local_2 = 0;
        while (_local_2 < this._width) {
          if (this._floorHoleMatrix[_local_3] === void 0) this._floorHoleMatrix[_local_3] = [];
          if (this._floorHoleMatrix[_local_3][_local_2]) {
            this.setTileHeight(_local_2, _local_3, _RoomPlaneParser.TILE_HOLE);
          }
          _local_2++;
        }
        _local_3++;
      }
      return this.initialize(_local_4);
    }
    initialize(k) {
      let _local_2 = 0;
      if (k != null) {
        _local_2 = this.getTileHeight(k.x, k.y);
        this.setTileHeight(k.x, k.y, _RoomPlaneParser.TILE_BLOCKED);
      }
      this._floorHeight = _RoomPlaneParser.getFloorHeight(this._tileMatrix);
      this.createWallPlanes();
      const _local_3 = [];
      for (const _local_4 of this._tileMatrix) _local_3.push(_local_4.concat());
      _RoomPlaneParser.padHeightMap(_local_3);
      _RoomPlaneParser.addTileTypes(_local_3);
      _RoomPlaneParser.unpadHeightMap(_local_3);
      const _local_5 = _RoomPlaneParser.expandFloorTiles(_local_3);
      this.extractPlanes(_local_5);
      if (k != null) {
        this.setTileHeight(k.x, k.y, _local_2);
        this.addFloor(new Vector3d(k.x + 0.5, k.y + 0.5, _local_2), new Vector3d(-1, 0, 0), new Vector3d(0, -1, 0), false, false, false, false);
      }
      return true;
    }
    generateWallData(k, _arg_2) {
      let _local_8;
      let _local_9;
      let _local_10;
      let _local_11;
      let _local_12;
      const _local_3 = new RoomWallData();
      const _local_4 = [this.extractTopWall.bind(this), this.extractRightWall.bind(this), this.extractBottomWall.bind(this), this.extractLeftWall.bind(this)];
      let _local_5 = 0;
      let _local_6 = new Point(k.x, k.y);
      let _local_7 = 0;
      while (_local_7++ < 1e3) {
        _local_8 = false;
        _local_9 = false;
        _local_10 = _local_5;
        if (_local_6.x < this.minX || _local_6.x > this.maxX || _local_6.y < this.minY || _local_6.y > this.maxY) {
          _local_8 = true;
        }
        _local_11 = _local_4[_local_5](_local_6, _arg_2);
        if (_local_11 == null) {
          return null;
        }
        _local_12 = Math.abs(_local_11.x - _local_6.x) + Math.abs(_local_11.y - _local_6.y);
        if (_local_6.x == _local_11.x || _local_6.y == _local_11.y) {
          _local_5 = (_local_5 - 1 + _local_4.length) % _local_4.length;
          _local_12 = _local_12 + 1;
          _local_9 = true;
        } else {
          _local_5 = (_local_5 + 1) % _local_4.length;
          _local_12--;
        }
        _local_3.addWall(_local_6, _local_10, _local_12, _local_8, _local_9);
        if (_local_11.x == k.x && _local_11.y == k.y && (!(_local_11.x == _local_6.x) || !(_local_11.y == _local_6.y))) {
          break;
        }
        _local_6 = _local_11;
      }
      if (_local_3.count == 0) {
        return null;
      }
      return _local_3;
    }
    hidePeninsulaWallChains(k) {
      let _local_5;
      let _local_6;
      let _local_7;
      let _local_8;
      let _local_2 = 0;
      const _local_3 = k.count;
      while (_local_2 < _local_3) {
        const _local_4 = _local_2;
        _local_5 = _local_2;
        _local_6 = 0;
        _local_7 = false;
        while (!k.getBorder(_local_2) && _local_2 < _local_3) {
          if (k.getLeftTurn(_local_2)) {
            _local_6++;
          } else {
            if (_local_6 > 0) {
              _local_6--;
            }
          }
          if (_local_6 > 1) {
            _local_7 = true;
          }
          _local_5 = _local_2;
          _local_2++;
        }
        if (_local_7) {
          _local_8 = _local_4;
          while (_local_8 <= _local_5) {
            k.setHideWall(_local_8, true);
            _local_8++;
          }
        }
        _local_2++;
      }
    }
    updateWallsNextToHoles(k) {
      let _local_4;
      let _local_5;
      let _local_6;
      let _local_7;
      let _local_8;
      let _local_9;
      let _local_10;
      const _local_2 = k.count;
      let _local_3 = 0;
      while (_local_3 < _local_2) {
        if (!k.getHideWall(_local_3)) {
          _local_4 = k.getCorner(_local_3);
          _local_5 = k.getDirection(_local_3);
          _local_6 = k.getLength(_local_3);
          _local_7 = RoomWallData.WALL_DIRECTION_VECTORS[_local_5];
          _local_8 = RoomWallData.WALL_NORMAL_VECTORS[_local_5];
          _local_9 = 0;
          _local_10 = 0;
          while (_local_10 < _local_6) {
            if (this.getTileHeightInternal(_local_4.x + _local_10 * _local_7.x - _local_8.x, _local_4.y + _local_10 * _local_7.y - _local_8.y) == _RoomPlaneParser.TILE_HOLE) {
              if (_local_10 > 0 && _local_9 == 0) {
                k.setLength(_local_3, _local_10);
                break;
              }
              _local_9++;
            } else {
              if (_local_9 > 0) {
                k.moveCorner(_local_3, _local_9);
                break;
              }
            }
            _local_10++;
          }
          if (_local_9 == _local_6) {
            k.setHideWall(_local_3, true);
          }
        }
        _local_3++;
      }
    }
    resolveOriginalWallIndex(k, _arg_2, _arg_3) {
      let _local_10;
      let _local_11;
      let _local_12;
      let _local_13;
      let _local_14;
      let _local_15;
      const _local_4 = Math.min(k.y, _arg_2.y);
      const _local_5 = Math.max(k.y, _arg_2.y);
      const _local_6 = Math.min(k.x, _arg_2.x);
      const _local_7 = Math.max(k.x, _arg_2.x);
      const _local_8 = _arg_3.count;
      let _local_9 = 0;
      while (_local_9 < _local_8) {
        _local_10 = _arg_3.getCorner(_local_9);
        _local_11 = _arg_3.getEndPoint(_local_9);
        if (k.x == _arg_2.x) {
          if (_local_10.x == k.x && _local_11.x == k.x) {
            _local_12 = Math.min(_local_10.y, _local_11.y);
            _local_13 = Math.max(_local_10.y, _local_11.y);
            if (_local_12 <= _local_4 && _local_5 <= _local_13) {
              return _local_9;
            }
          }
        } else {
          if (k.y == _arg_2.y) {
            if (_local_10.y == k.y && _local_11.y == k.y) {
              _local_14 = Math.min(_local_10.x, _local_11.x);
              _local_15 = Math.max(_local_10.x, _local_11.x);
              if (_local_14 <= _local_6 && _local_7 <= _local_15) {
                return _local_9;
              }
            }
          }
        }
        _local_9++;
      }
      return -1;
    }
    hideOriginallyHiddenWalls(k, _arg_2) {
      let _local_5;
      let _local_6;
      let _local_7;
      let _local_8;
      let _local_9;
      const _local_3 = k.count;
      let _local_4 = 0;
      while (_local_4 < _local_3) {
        if (!k.getHideWall(_local_4)) {
          _local_5 = k.getCorner(_local_4);
          _local_6 = new Point(_local_5.x, _local_5.y);
          _local_7 = RoomWallData.WALL_DIRECTION_VECTORS[k.getDirection(_local_4)];
          _local_8 = k.getLength(_local_4);
          _local_6.x = _local_6.x + _local_7.x * _local_8;
          _local_6.y = _local_6.y + _local_7.y * _local_8;
          _local_9 = this.resolveOriginalWallIndex(_local_5, _local_6, _arg_2);
          if (_local_9 >= 0) {
            if (_arg_2.getHideWall(_local_9)) {
              k.setHideWall(_local_4, true);
            }
          } else {
            k.setHideWall(_local_4, true);
          }
        }
        _local_4++;
      }
    }
    checkWallHiding(k, _arg_2) {
      this.hidePeninsulaWallChains(_arg_2);
      this.updateWallsNextToHoles(k);
      this.hideOriginallyHiddenWalls(k, _arg_2);
    }
    addWalls(k, _arg_2) {
      const _local_3 = k.count;
      const _local_4 = _arg_2.count;
      let _local_7 = 0;
      while (_local_7 < _local_3) {
        if (!k.getHideWall(_local_7)) {
          const _local_8 = k.getCorner(_local_7);
          const _local_9 = k.getDirection(_local_7);
          const _local_10 = k.getLength(_local_7);
          const _local_11 = RoomWallData.WALL_DIRECTION_VECTORS[_local_9];
          const _local_12 = RoomWallData.WALL_NORMAL_VECTORS[_local_9];
          let _local_13 = -1;
          let _local_14 = 0;
          while (_local_14 < _local_10) {
            const _local_27 = this.getTileHeightInternal(_local_8.x + _local_14 * _local_11.x + _local_12.x, _local_8.y + _local_14 * _local_11.y + _local_12.y);
            if (_local_27 >= 0 && (_local_27 < _local_13 || _local_13 < 0)) {
              _local_13 = _local_27;
            }
            _local_14++;
          }
          const _local_15 = _local_13;
          let _local_16 = new Vector3d(_local_8.x, _local_8.y, _local_15);
          _local_16 = Vector3d.sum(_local_16, Vector3d.product(_local_12, 0.5));
          _local_16 = Vector3d.sum(_local_16, Vector3d.product(_local_11, -0.5));
          const _local_17 = this.wallHeight + Math.min(_RoomPlaneParser.MAX_WALL_ADDITIONAL_HEIGHT, this.floorHeight) - _local_13;
          const _local_18 = Vector3d.product(_local_11, -_local_10);
          const _local_19 = new Vector3d(0, 0, _local_17);
          _local_16 = Vector3d.dif(_local_16, _local_18);
          const _local_20 = this.resolveOriginalWallIndex(_local_8, k.getEndPoint(_local_7), _arg_2);
          let _local_5 = 0;
          let _local_6 = 0;
          if (_local_20 >= 0) {
            _local_5 = _arg_2.getDirection((_local_20 + 1) % _local_4);
            _local_6 = _arg_2.getDirection((_local_20 - 1 + _local_4) % _local_4);
          } else {
            _local_5 = k.getDirection((_local_7 + 1) % _local_3);
            _local_6 = k.getDirection((_local_7 - 1 + _local_3) % _local_3);
          }
          let _local_21 = null;
          if ((_local_5 - _local_9 + 4) % 4 == 3) {
            _local_21 = RoomWallData.WALL_NORMAL_VECTORS[_local_5];
          } else {
            if ((_local_9 - _local_6 + 4) % 4 == 3) {
              _local_21 = RoomWallData.WALL_NORMAL_VECTORS[_local_6];
            }
          }
          const _local_22 = k.getLeftTurn(_local_7);
          const _local_23 = k.getLeftTurn((_local_7 - 1 + _local_3) % _local_3);
          const _local_24 = k.getHideWall((_local_7 + 1) % _local_3);
          const _local_25 = k.getManuallyLeftCut(_local_7);
          const _local_26 = k.getManuallyRightCut(_local_7);
          this.addWall(_local_16, _local_18, _local_19, _local_21, !_local_23 || _local_25, !_local_22 || _local_26, !_local_24);
        }
        _local_7++;
      }
    }
    createWallPlanes() {
      let _local_13;
      let _local_14;
      const k = this._tileMatrix;
      if (k == null) {
        return false;
      }
      let _local_2;
      let _local_3;
      let _local_4;
      const _local_5 = k.length;
      let _local_6 = 0;
      if (_local_5 == 0) {
        return false;
      }
      _local_2 = 0;
      while (_local_2 < _local_5) {
        _local_4 = k[_local_2];
        if (_local_4 == null || _local_4.length == 0) {
          return false;
        }
        if (_local_6 > 0) {
          _local_6 = Math.min(_local_6, _local_4.length);
        } else {
          _local_6 = _local_4.length;
        }
        _local_2++;
      }
      const _local_7 = Math.min(_RoomPlaneParser.MAX_WALL_ADDITIONAL_HEIGHT, this._fixedWallHeight != -1 ? this._fixedWallHeight : _RoomPlaneParser.getFloorHeight(k));
      const _local_8 = this.minX;
      let _local_9 = this.minY;
      _local_9 = this.minY;
      while (_local_9 <= this.maxY) {
        if (this.getTileHeightInternal(_local_8, _local_9) > _RoomPlaneParser.TILE_HOLE) {
          _local_9--;
          break;
        }
        _local_9++;
      }
      if (_local_9 > this.maxY) {
        return false;
      }
      const _local_10 = new Point(_local_8, _local_9);
      const _local_11 = this.generateWallData(_local_10, true);
      const _local_12 = this.generateWallData(_local_10, false);
      if (_local_11 != null) {
        _local_13 = _local_11.count;
        _local_14 = _local_12.count;
        this.checkWallHiding(_local_11, _local_12);
        this.addWalls(_local_11, _local_12);
      }
      _local_3 = 0;
      while (_local_3 < this.tileMapHeight) {
        _local_2 = 0;
        while (_local_2 < this.tileMapWidth) {
          if (this.getTileHeightInternal(_local_2, _local_3) < 0) {
            this.setTileHeight(_local_2, _local_3, -(_local_7 + this.wallHeight));
          }
          _local_2++;
        }
        _local_3++;
      }
      return true;
    }
    extractTopWall(k, _arg_2) {
      if (k == null) {
        return null;
      }
      let _local_3 = 1;
      let _local_4 = _RoomPlaneParser.TILE_HOLE;
      if (!_arg_2) {
        _local_4 = _RoomPlaneParser.TILE_BLOCKED;
      }
      while (_local_3 < 1e3) {
        if (this.getTileHeightInternal(k.x + _local_3, k.y) > _local_4) {
          return new Point(k.x + _local_3 - 1, k.y);
        }
        if (this.getTileHeightInternal(k.x + _local_3, k.y + 1) <= _local_4) {
          return new Point(k.x + _local_3, k.y + 1);
        }
        _local_3++;
      }
      return null;
    }
    extractRightWall(k, _arg_2) {
      if (k == null) {
        return null;
      }
      let _local_3 = 1;
      let _local_4 = _RoomPlaneParser.TILE_HOLE;
      if (!_arg_2) {
        _local_4 = _RoomPlaneParser.TILE_BLOCKED;
      }
      while (_local_3 < 1e3) {
        if (this.getTileHeightInternal(k.x, k.y + _local_3) > _local_4) {
          return new Point(k.x, k.y + (_local_3 - 1));
        }
        if (this.getTileHeightInternal(k.x - 1, k.y + _local_3) <= _local_4) {
          return new Point(k.x - 1, k.y + _local_3);
        }
        _local_3++;
      }
      return null;
    }
    extractBottomWall(k, _arg_2) {
      if (k == null) {
        return null;
      }
      let _local_3 = 1;
      let _local_4 = _RoomPlaneParser.TILE_HOLE;
      if (!_arg_2) {
        _local_4 = _RoomPlaneParser.TILE_BLOCKED;
      }
      while (_local_3 < 1e3) {
        if (this.getTileHeightInternal(k.x - _local_3, k.y) > _local_4) {
          return new Point(k.x - (_local_3 - 1), k.y);
        }
        if (this.getTileHeightInternal(k.x - _local_3, k.y - 1) <= _local_4) {
          return new Point(k.x - _local_3, k.y - 1);
        }
        _local_3++;
      }
      return null;
    }
    extractLeftWall(k, _arg_2) {
      if (k == null) {
        return null;
      }
      let _local_3 = 1;
      let _local_4 = _RoomPlaneParser.TILE_HOLE;
      if (!_arg_2) {
        _local_4 = _RoomPlaneParser.TILE_BLOCKED;
      }
      while (_local_3 < 1e3) {
        if (this.getTileHeightInternal(k.x, k.y - _local_3) > _local_4) {
          return new Point(k.x, k.y - (_local_3 - 1));
        }
        if (this.getTileHeightInternal(k.x + 1, k.y - _local_3) <= _local_4) {
          return new Point(k.x + 1, k.y - _local_3);
        }
        _local_3++;
      }
      return null;
    }
    addWall(k, _arg_2, _arg_3, _arg_4, _arg_5, _arg_6, _arg_7) {
      this.addPlane(RoomPlaneData.PLANE_WALL, k, _arg_2, _arg_3, [_arg_4]);
      const _local_8 = _RoomPlaneParser.WALL_THICKNESS * this._wallThicknessMultiplier;
      const _local_9 = _RoomPlaneParser.FLOOR_THICKNESS * this._floorThicknessMultiplier;
      const _local_10 = Vector3d.crossProduct(_arg_2, _arg_3);
      const _local_11 = Vector3d.product(_local_10, 1 / _local_10.length * -_local_8);
      this.addPlane(RoomPlaneData.PLANE_WALL, Vector3d.sum(k, _arg_3), _arg_2, _local_11, [_local_10, _arg_4]);
      if (_arg_5) {
        this.addPlane(RoomPlaneData.PLANE_WALL, Vector3d.sum(Vector3d.sum(k, _arg_2), _arg_3), Vector3d.product(_arg_3, -(_arg_3.length + _local_9) / _arg_3.length), _local_11, [_local_10, _arg_4]);
      }
      if (_arg_6) {
        this.addPlane(RoomPlaneData.PLANE_WALL, Vector3d.sum(k, Vector3d.product(_arg_3, -_local_9 / _arg_3.length)), Vector3d.product(_arg_3, (_arg_3.length + _local_9) / _arg_3.length), _local_11, [_local_10, _arg_4]);
        if (_arg_7) {
          const _local_12 = Vector3d.product(_arg_2, _local_8 / _arg_2.length);
          this.addPlane(RoomPlaneData.PLANE_WALL, Vector3d.sum(Vector3d.sum(k, _arg_3), Vector3d.product(_local_12, -1)), _local_12, _local_11, [_local_10, _arg_2, _arg_4]);
        }
      }
    }
    addFloor(k, _arg_2, _arg_3, _arg_4, _arg_5, _arg_6, _arg_7) {
      let _local_9;
      let _local_10;
      let _local_11;
      const _local_8 = this.addPlane(RoomPlaneData.PLANE_FLOOR, k, _arg_2, _arg_3);
      if (_local_8 != null) {
        _local_9 = _RoomPlaneParser.FLOOR_THICKNESS * this._floorThicknessMultiplier;
        _local_10 = new Vector3d(0, 0, _local_9);
        _local_11 = Vector3d.dif(k, _local_10);
        if (_arg_6) {
          this.addPlane(RoomPlaneData.PLANE_FLOOR, _local_11, _arg_2, _local_10);
        }
        if (_arg_7) {
          this.addPlane(RoomPlaneData.PLANE_FLOOR, Vector3d.sum(_local_11, Vector3d.sum(_arg_2, _arg_3)), Vector3d.product(_arg_2, -1), _local_10);
        }
        if (_arg_4) {
          this.addPlane(RoomPlaneData.PLANE_FLOOR, Vector3d.sum(_local_11, _arg_3), Vector3d.product(_arg_3, -1), _local_10);
        }
        if (_arg_5) {
          this.addPlane(RoomPlaneData.PLANE_FLOOR, Vector3d.sum(_local_11, _arg_2), _arg_3, _local_10);
        }
      }
    }
    initializeFromMapData(data) {
      if (!data) return false;
      this.reset();
      this.resetFloorHoles();
      const width = data.width;
      const height = data.height;
      const wallHeight = data.wallHeight;
      const fixedWallsHeight = data.fixedWallsHeight;
      this.initializeTileMap(width, height);
      if (data.tileMap) {
        let y = 0;
        while (y < data.tileMap.length) {
          const row = data.tileMap[y];
          if (row) {
            let x = 0;
            while (x < row.length) {
              const column = row[x];
              if (column) this.setTileHeight(x, y, column.height);
              x++;
            }
          }
          y++;
        }
      }
      if (data.holeMap && data.holeMap.length) {
        let index = 0;
        while (index < data.holeMap.length) {
          const hole = data.holeMap[index];
          if (!hole) continue;
          this.addFloorHole(hole.id, hole.x, hole.y, hole.width, hole.height);
          index++;
        }
        this.initializeHoleMap();
      }
      this.wallHeight = wallHeight;
      this.restrictsDragging = data.restrictsDragging;
      this.restrictsScaling = data.restrictsScaling;
      this.restrictedScale = data.restrictedScale;
      this.initializeFromTileData(fixedWallsHeight);
      return true;
    }
    addPlane(k, _arg_2, _arg_3, _arg_4, _arg_5 = null) {
      if (_arg_3.length == 0 || _arg_4.length == 0) {
        return null;
      }
      const _local_6 = new RoomPlaneData(k, _arg_2, _arg_3, _arg_4, _arg_5);
      this._planes.push(_local_6);
      return _local_6;
    }
    getMapData() {
      const data = new RoomMapData();
      data.width = this._width;
      data.height = this._height;
      data.wallHeight = this._wallHeight;
      data.fixedWallsHeight = this._fixedWallHeight;
      data.dimensions.minX = this.minX;
      data.dimensions.maxX = this.maxX;
      data.dimensions.minY = this.minY;
      data.dimensions.maxY = this.maxY;
      data.restrictsDragging = this.restrictsDragging;
      data.restrictsScaling = this.restrictsScaling;
      data.restrictedScale = this.restrictedScale;
      let y = 0;
      while (y < this._height) {
        const tileRow = [];
        const tileMatrix = this._tileMatrixOriginal[y];
        let x = 0;
        while (x < this._width) {
          const tileHeight = tileMatrix[x];
          tileRow.push({ height: tileHeight });
          x++;
        }
        data.tileMap.push(tileRow);
        y++;
      }
      for (const [holeId, holeData] of this._floorHoles.entries()) {
        if (!holeData) continue;
        data.holeMap.push({
          id: holeId,
          x: holeData.x,
          y: holeData.y,
          width: holeData.width,
          height: holeData.height
        });
      }
      return data;
    }
    getPlaneLocation(k) {
      if (k < 0 || k >= this.planeCount) return null;
      const planeData = this._planes[k];
      if (!planeData) return null;
      return planeData.loc;
    }
    getPlaneNormal(k) {
      if (k < 0 || k >= this.planeCount) return null;
      const planeData = this._planes[k];
      if (!planeData) return null;
      return planeData.normal;
    }
    getPlaneLeftSide(k) {
      if (k < 0 || k >= this.planeCount) return null;
      const planeData = this._planes[k];
      if (!planeData) return null;
      return planeData.leftSide;
    }
    getPlaneRightSide(k) {
      if (k < 0 || k >= this.planeCount) return null;
      const planeData = this._planes[k];
      if (!planeData) return null;
      return planeData.rightSide;
    }
    getPlaneNormalDirection(k) {
      if (k < 0 || k >= this.planeCount) return null;
      const planeData = this._planes[k];
      if (!planeData) return null;
      return planeData.normalDirection;
    }
    getPlaneSecondaryNormals(k) {
      let _local_3;
      let _local_4;
      if (k < 0 || k >= this.planeCount) {
        return null;
      }
      const _local_2 = this._planes[k];
      if (_local_2 != null) {
        _local_3 = [];
        _local_4 = 0;
        while (_local_4 < _local_2.secondaryNormalCount) {
          _local_3.push(_local_2.getSecondaryNormal(_local_4));
          _local_4++;
        }
        return _local_3;
      }
      return null;
    }
    getPlaneType(k) {
      if (k < 0 || k >= this.planeCount) return RoomPlaneData.PLANE_UNDEFINED;
      const planeData = this._planes[k];
      if (!planeData) return RoomPlaneData.PLANE_UNDEFINED;
      return planeData.type;
    }
    getPlaneMaskCount(k) {
      if (k < 0 || k >= this.planeCount) return 0;
      const planeData = this._planes[k];
      if (!planeData) return 0;
      return planeData.maskCount;
    }
    getPlaneMaskLeftSideLoc(k, _arg_2) {
      if (k < 0 || k >= this.planeCount) return -1;
      const planeData = this._planes[k];
      if (!planeData) return -1;
      return planeData.getMaskLeftSideLoc(_arg_2);
    }
    getPlaneMaskRightSideLoc(k, _arg_2) {
      if (k < 0 || k >= this.planeCount) return -1;
      const planeData = this._planes[k];
      if (!planeData) return -1;
      return planeData.getMaskRightSideLoc(_arg_2);
    }
    getPlaneMaskLeftSideLength(k, _arg_2) {
      if (k < 0 || k >= this.planeCount) return -1;
      const planeData = this._planes[k];
      if (!planeData) return -1;
      return planeData.getMaskLeftSideLength(_arg_2);
    }
    getPlaneMaskRightSideLength(k, _arg_2) {
      if (k < 0 || k >= this.planeCount) return -1;
      const planeData = this._planes[k];
      if (!planeData) return -1;
      return planeData.getMaskRightSideLength(_arg_2);
    }
    addFloorHole(k, _arg_2, _arg_3, _arg_4, _arg_5) {
      this.removeFloorHole(k);
      this._floorHoles.set(k, new RoomFloorHole(_arg_2, _arg_3, _arg_4, _arg_5));
    }
    removeFloorHole(k) {
      this._floorHoles.delete(k);
    }
    resetFloorHoles() {
      this._floorHoles.clear();
    }
    initializeHoleMap() {
      let k;
      let _local_2;
      let _local_3;
      let _local_5;
      let _local_6;
      let _local_7;
      let _local_8;
      let _local_9;
      _local_2 = 0;
      while (_local_2 < this._height) {
        _local_3 = this._floorHoleMatrix[_local_2];
        k = 0;
        while (k < this._width) {
          _local_3[k] = false;
          k++;
        }
        _local_2++;
      }
      for (const _local_4 of this._floorHoles.values()) {
        _local_5 = _local_4;
        if (_local_5 != null) {
          _local_6 = _local_5.x;
          _local_7 = _local_5.x + _local_5.width - 1;
          _local_8 = _local_5.y;
          _local_9 = _local_5.y + _local_5.height - 1;
          _local_6 = _local_6 < 0 ? 0 : _local_6;
          _local_7 = _local_7 >= this._width ? this._width - 1 : _local_7;
          _local_8 = _local_8 < 0 ? 0 : _local_8;
          _local_9 = _local_9 >= this._height ? this._height - 1 : _local_9;
          _local_2 = _local_8;
          while (_local_2 <= _local_9) {
            _local_3 = this._floorHoleMatrix[_local_2];
            k = _local_6;
            while (k <= _local_7) {
              _local_3[k] = true;
              k++;
            }
            _local_2++;
          }
        }
      }
    }
    extractPlanes(k) {
      let _local_7;
      let _local_8;
      let _local_9;
      let _local_10;
      let _local_11;
      let _local_12;
      let _local_13;
      let _local_14;
      let _local_15;
      let _local_16;
      let _local_17;
      let _local_18;
      let _local_19;
      let _local_20;
      let _local_21;
      const _local_2 = k.length;
      const _local_3 = k[0].length;
      const _local_4 = [];
      let _local_5 = 0;
      while (_local_5 < _local_2) {
        _local_4[_local_5] = [];
        _local_5++;
      }
      let _local_6 = 0;
      while (_local_6 < _local_2) {
        _local_7 = 0;
        while (_local_7 < _local_3) {
          _local_8 = k[_local_6][_local_7];
          if (_local_8 < 0 || _local_4[_local_6][_local_7]) {
          } else {
            _local_11 = _local_7 == 0 || !(k[_local_6][_local_7 - 1] == _local_8);
            _local_12 = _local_6 == 0 || !(k[_local_6 - 1][_local_7] == _local_8);
            _local_9 = _local_7 + 1;
            while (_local_9 < _local_3) {
              if (!(k[_local_6][_local_9] == _local_8) || _local_4[_local_6][_local_9] || _local_6 > 0 && k[_local_6 - 1][_local_9] == _local_8 == _local_12) {
                break;
              }
              _local_9++;
            }
            _local_13 = _local_9 == _local_3 || !(k[_local_6][_local_9] == _local_8);
            _local_17 = false;
            _local_10 = _local_6 + 1;
            while (_local_10 < _local_2 && !_local_17) {
              _local_14 = !(k[_local_10][_local_7] == _local_8);
              _local_17 = _local_14 || _local_7 > 0 && k[_local_10][_local_7 - 1] == _local_8 == _local_11 || _local_9 < _local_3 && k[_local_10][_local_9] == _local_8 == _local_13;
              _local_15 = _local_7;
              while (_local_15 < _local_9) {
                if (k[_local_10][_local_15] == _local_8 == _local_14) {
                  _local_17 = true;
                  _local_9 = _local_15;
                  break;
                }
                _local_15++;
              }
              if (_local_17) {
                break;
              }
              _local_10++;
            }
            _local_14 = _local_14 || _local_10 == _local_2;
            _local_13 = _local_9 == _local_3 || !(k[_local_6][_local_9] == _local_8);
            _local_16 = _local_6;
            while (_local_16 < _local_10) {
              _local_15 = _local_7;
              while (_local_15 < _local_9) {
                _local_4[_local_16][_local_15] = true;
                _local_15++;
              }
              _local_16++;
            }
            _local_18 = _local_7 / 4 - 0.5;
            _local_19 = _local_6 / 4 - 0.5;
            _local_20 = (_local_9 - _local_7) / 4;
            _local_21 = (_local_10 - _local_6) / 4;
            this.addFloor(new Vector3d(_local_18 + _local_20, _local_19 + _local_21, _local_8 / 4), new Vector3d(-_local_20, 0, 0), new Vector3d(0, -_local_21, 0), _local_13, _local_11, _local_14, _local_12);
          }
          _local_7++;
        }
        _local_6++;
      }
    }
    get restrictsDragging() {
      return this._restrictsDragging;
    }
    set restrictsDragging(flag) {
      this._restrictsDragging = flag;
    }
    get restrictsScaling() {
      return this._restrictsScaling;
    }
    set restrictsScaling(flag) {
      this._restrictsScaling = flag;
    }
    get restrictedScale() {
      return this._restrictedScale;
    }
    set restrictedScale(scale) {
      this._restrictedScale = scale;
    }
  };

  // src/applyTilemap.ts
  var ROOM_OBJECT_ID = -1;
  function applyTilemapLive(tilemapString, wallHeight, scale, doorX, doorY) {
    const engine = window.RoomEngine;
    const roomId = window.Room && window.Room.id;
    if (!engine || !engine.ready || roomId == null) return false;
    const parser = new FloorHeightMapMessageParser();
    parser.flush();
    parser.parseModel(tilemapString, wallHeight, scale);
    const planeParser = new RoomPlaneParser();
    planeParser.initializeTileMap(parser.width, parser.height);
    for (let y = 0; y < parser.height; y++) {
      for (let x = 0; x < parser.width; x++) {
        planeParser.setTileHeight(x, y, parser.getHeight(x, y));
      }
    }
    const doorZ = parser.getHeight(Math.floor(doorX), Math.floor(doorY));
    planeParser.setTileHeight(Math.floor(doorX), Math.floor(doorY), doorZ);
    planeParser.initializeFromTileData(parser.wallHeight);
    planeParser.setTileHeight(Math.floor(doorX), Math.floor(doorY), doorZ + planeParser.wallHeight);
    const roomMap = planeParser.getMapData();
    roomMap.doors.push({ x: doorX, y: doorY, z: doorZ, dir: 90 });
    const roomObject = engine.getRoomObject(roomId, ROOM_OBJECT_ID, RoomObjectCategory.ROOM);
    planeParser.dispose();
    if (!roomObject) return false;
    roomObject.processUpdateMessage(new ObjectRoomMapUpdateMessage(roomMap));
    engine.refreshTileObjectMap(roomId, "floor-editor.applyTilemapLive");
    return true;
  }
  window.__fe_applyTilemapLive = applyTilemapLive;
})();
/*! Bundled license information:

@pixi/math/dist/esm/math.js:
  (*!
   * @pixi/math - v6.4.2
   * Compiled Thu, 02 Jun 2022 15:39:26 UTC
   *
   * @pixi/math is licensed under the MIT License.
   * http://www.opensource.org/licenses/mit-license
   *)
*/
} catch (e) { window.__fe_loadError = (e && e.stack) ? e.stack : String(e); }
