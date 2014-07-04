module.exports = {
    getEpochTime: function (time) {
        var d = new Date();
        d.setMonth(4);
        d.setDate(2);
        d.setHours(0, 0, 0, 0);
        d.setFullYear(2014);
        var t = d.getTime();
        return parseInt((time - t) / 1000);
    },

    epochTime : function () {
        var d = new Date();
        d.setMonth(4);
        d.setDate(2);
        d.setHours(0, 0, 0, 0);
        d.setFullYear(2014);
        var t = parseInt(d.getTime() / 1000);

        return t;
    },

    moreThanEightDigits : function (number) {
        if (number.toString().indexOf(".") < 0) {
            return false;
        }
        else{
            if(number.toString().split('.')[1].length>8){
                return true;
            }
            else{
                return false;
            }
        }
    }

}

Number.prototype.roundTo = function( digitsCount ){
    var digitsCount = typeof digitsCount !== 'undefined' ? digitsCount : 2;
    var s = String(this);
    var e = s.indexOf('.');
    if( e == -1 ) return this;
    var c = s.length - e - 1;
    if( c < digitsCount ) digitsCount = c;
    var e1 = e + 1 + digitsCount;
    var d = Number(s.substr(0,e) + s.substr(e+1, digitsCount));
    if( s[e1] > 4 ) d += 1;
    d /= Math.pow(10, digitsCount);
    return d.valueOf();
}

Math.roundTo = function( number ,digitsCount){
    number = Number(number);
    return number.roundTo(digitsCount).valueOf();
}