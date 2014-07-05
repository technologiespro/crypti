webApp.filter('feeFilter', function () {
    return function (fee) {
        var r = fee.toFixed(8);
        var clear = "";
        var findValue = false;
        for (var i = r.length - 1; i >= 0; i--) {
            if (findValue) {
                clear += r[i];
            } else {
                if (r[i] != '0') {
                    findValue = true;
                    clear += r[i];
                }
            }
        }

        var result = clear.split("").reverse().join("");
        if (result[result.length - 1] == '.') {
            result = result.substr(0, result.length - 2);
        }

        return result;
    }
});