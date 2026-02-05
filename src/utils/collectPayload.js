const encodePayload = function() {
        let e = 16384
          , t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        return function(i) {
            let n = [];
            i = unescape(encodeURIComponent(i));
            for (let e = 0; e < i.length; e++)
                n.push(i.charCodeAt(e));
            return function(i) {
                let n = []
                  , r = []
                  , s = -1
                  , o = 0
                  , a = 0
                  , l = 0
                  , c = 0
                  , d = [];
                encodeByte(19);
                let u = 0;
                for (; u < i.length && a < i.length; u += e)
                    u > 0 && (r = r.slice(e)),
                    processChunk();
                return -1 != s && encodeLiterals(),
                2 == c ? writeChar(l << 4 & 63) : 4 == c && writeChar(l << 2 & 63),
                d.join("");
                function processChunk() {
                    let t = getMin(u + 32768, i.length)
                      , l = getMin(t, i.length - 3 + 1);
                    for (; a < t; a++) {
                        let t = 0
                          , i = 0;
                        if (a < l) {
                            let s = calculateHash();
                            if (a >= o) {
                                let o = n[s] - 1;
                                for (; 130 != t && o >= 0 && o >= a - e; ) {
                                    let e = findMatchLength(o);
                                    e >= 3 && e > t && (t = e,
                                    i = a - o - t),
                                    o = r[o - u]
                                }
                            }
                            r[a - u] = n[s] - 1,
                            n[s] = a + 1
                        }
                        if (t >= 3) {
                            for (o = a + t,
                            -1 != s && (encodeLiterals(),
                            s = -1),
                            encodeByte(t - 3); i > 127; )
                                encodeByte(127 & i | 128),
                                i >>= 7;
                            encodeByte(i)
                        } else
                            a >= o && -1 == s && (s = a)
                    }
                }
                function getMin(e, t) {
                    return Math.min(e, t)
                }
                function calculateHash() {
                    let e = 0;
                    for (let t = a; t < a + 3; t++)
                        e *= 16777619,
                        e ^= i[t];
                    return 16383 & e
                }
                function findMatchLength(e) {
                    let t, n, r = getMin(e + 130, a);
                    for (t = e,
                    n = a; t < r && n < i.length && i[t] == i[n]; t++,
                    n++)
                        ;
                    return t - e
                }
                function encodeLiterals() {
                    for (let e = s; e < a; e += 127) {
                        let t = getMin(127, a - e);
                        encodeByte(255 & -t);
                        for (let n = e; n < a && n < e + t; n++)
                            encodeByte(i[n])
                    }
                }
                function encodeByte(e) {
                    let t = l << 6 - c;
                    l = 255 & e,
                    c += 2,
                    t |= l >> c,
                    writeChar(63 & t),
                    c >= 6 && (c -= 6,
                    t = l >> c,
                    writeChar(63 & t))
                }
                function writeChar(e) {
                    d.push(t.charAt(e))
                }
            }(n)
        }
    }()

const c = {
    "context": [
        "10320667452",
        "1769744808271.65f8Qt49rXge",
        1,
        6,
        "1.3.78/new/t",
        100014851,
        null,
        null,
        "online",
        "09034177410240614425",
        "https://id.trip.com/flights/showfarefirst?pagesource=list&lowpricesource=searchForm&triptype=RT&class=Y&quantity=1&childqty=0&babyqty=0&dcity=jkt&acity=sin&ddate=2026-02-01&locale=en-ID&curr=IDR&rdate=2026-02-03&airline=",
        "10320667452",
        5,
        1,
        1536,
        864,
        1261,
        27,
        47,
        "en-us",
        "",
        "",
        "{\"version\":\"\",\"net\":\"None\",\"platform\":\"\"}",
        1.25,
        "{\"fef_name\":\"\",\"fef_ver\":\"\",\"rg\":\"\",\"lang\":\"en-ID\",\"lizard\":\"\"}",
        "SGP-ALI",
        "100014851-0a9aa022-491596-282364",
        null,
        null,
        "",
        true,
        false,
        null,
        null
    ],
    "business": [
        "",
        "",
        "",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        {
            "enterTs": 1769746870047,
            "instKey": "66d8UU",
            "npmVersion": "1.6.5",
            "npmEnterTs": 1769746869924,
            "init_cki": "E-VHVUlEPTA5MDM0MTc3NDEwMjQwNjE0NDI1OyABF6guc2lnPXliN2NGYWJKUEJxR1FETjR5c1ZRQm5ELV9pNkRBbG9FQ2NhWHpuUnlYTVE7IGNvb2tpZVByaWNlc0Rpc3BsYXllZD1JRFI7IGlidV9jb3VudHJ5AA4FCAEr_V9zdAAuyHQ9MDsgX2FidGVzdF91c2VyaWQ9MDQ3NzI1MmEtYjZlYi00MWMzLThjMzMtMDk3MjlhYjZiNWRkAkX1bGFuZ3VhZ2U9RU4DCvZvY2FsZT1lbl9pAB76eC1jdHgtAVDvLXJlY29nbml6ZT1OT05fRVUDggHqb25saW5lX3Blcm1pc3Npb25fY2xzXwCQAf8xGQTvZ2FwPTE3Njk3NDQ4MTEzOTQAvQHrZ2NsX2F1PTEuMS4xNzQ5MzA3ODAyAAgEH_8yACDmZndiPTUzNGJDbVUzekZnRTA3S3ltRmdvMmgHHv0xNjUBJ_tnYT1HQQJHAJID-jQyNzA1NQw9-2JwPWZiAmgFDus1MzkuNDIyOTQxMzI5NzY1NTg2MzgAzgOuX3Bpbl91bmF1dGg9ZFdsa1BVNXRWbXBPUkdjeldXcFJkRTFFVFRWTlF6QXdUa2RWTlV4VVp6Uk5SRUYwV1hwS2FGbFVSVEZhUkVFMFRtMUpkdwBR_1ICvQTVNTFiYzE3MGQtY2NiNy00ZDM3LTk2OGUtMGQzYzhkOTk1OTg3OyBVQlRfVgArBaMB7jA4MjcxLjY1ZjhRdDQ5clhnZQBO_WJmYQG5AhYKBuIB_DY2NTQAswUFBvs3MzQ4NwCaAv8uAAH4MDMyMDY2NzQCvgL8Y29tYgC5A_1kPXAAnAT7SWQlM0QIFfUlMjZ0cmFuc2FjdADSAwMY5y1tZi0yMDI2MDEzMDExMTg1NTQ2OS1XRUIAKvtpbml0UBMyANsE_mRpAcUF_mJ1AUj4Y2hhbm5lbHMAJfxGYWxzANgB6ndjc19idD1zXzMzZmIzMzQ5NjZlOToGtgH_OACpAfx1ZXRzAPMF4DUwYThhNzQwZmQ4ZTExZjBiOWRiYzM4ZTJhMTk4ZjQzAyT_dgQj_WIyMgcg8TVhMzQzZTM5MGNmZDBiNgK-BPJfWDQzN0RaNzNNUj1HUwCKBf4ucwfeBPgkbzEkZzEkdAWAAfU1MSRqNDckbDAkaACMBwDKAfxzaXRlBagH-mdyb3VwPQDhAbNwOyBGVlA9eWRuajFaOGEwNHA5Yno0T3VHMVR0alFVRzNtQnZuemUlMkZmbmRBcnJOMUlTYyUyQlh1cmRKYXVEVTQ5SmE0Q0ppZ1VhawAV5Ut1YXdFYkJOcktRdG1kN2ROQnVkVUxuc3lOWQCmBv51SwAg2VlvN3NwNE5uMjJrS0VXUFZmVjJrMzh6R25TR3R6cE5xb0VKbmV2VQBw4XVOaFh5bDl0dXJzZlZOSTBlQWNVV1FDQVF6VWZaVkkAjwM",
            "bizTokens": [],
            "eid": null,
            "framework": "web-core",
            "tcpSend": false,
            "isSupportWasm": true,
            "isOverseas": "true",
            "tld": "trip.com",
            "captainAppId": "100014851",
            "lsSize": 17999,
            "ubt_language": "en",
            "ubt_currency": "IDR",
            "ubt_site": "ID",
            "ubt_locale": "en-ID",
            "wcVersion": "2.0.91",
            "flighttype": "D",
            "flightinformation": {
                "segmentinfo": [
                    {
                        "segmentno": 1,
                        "segments": [
                            {
                                "sequence": 1,
                                "dport": "JKT",
                                "aport": "SIN",
                                "takeofftime": "2026-02-01"
                            }
                        ]
                    },
                    {
                        "segmentno": 2,
                        "segments": [
                            {
                                "sequence": 1,
                                "dport": "SIN",
                                "aport": "JKT",
                                "takeofftime": "2026-02-03"
                            }
                        ]
                    }
                ],
                "airlineclass": "Y",
                "adult": 1,
                "child": 0,
                "infant": 0
            },
            "__ubt_user_data_length": 304,
            "ubt_reqid": "17697468704904518iy"
        }
    ],
    "user": [
        null,
        "M:44,240912_IBU_jpwjo:A;M:43,241224_IBU_TOLNG:B;M:86,250109_IBU_OLFBO:D;M:3,250207_IBU_FLTOLM:B;M:2,250403_IBU_PDOOL:A;M:9,250427_IBU_TCBOL:A;M:76,250626_IBU_refresh:A;M:73,250710_IBU_meta:A;M:36,250710_IBU_automore:B;M:8,250710_IBU_stgp:B;M:76,250630_IBU_omp3:A;M:55,250716_IBU_Flightcard:A;M:6,250716_IBU_FCredesg:E;M:60,250630_IBU_BSOOL:C;M:21,250724_IBU_TooltipInt:A;M:9,250730_IBU_Load15:A;M:67,250807_IBU_sea:A;M:21,250811_IBU_wjrankol:A;M:21,250811_IBU_law:B;M:8,250806_IBU_Off2Scroll:B;M:34,250806_IBU_FiltersOpt:A;M:63,250730_IBU_OLNOHIDFE:A;M:42,250812_IBU_SDoubleCTA:B;M:36,250812_IBU_FiltersOp2:A;M:71,250924_IBU_OLYPGZ:B;M:18,251022_IBU_HoverRed:B;M:57,251031_IBU_lppg:E;M:95,251023_IBU_pricetool:A;M:16,251110_IBU_TVCOL:A;M:45,251010_IBU_mfm:A;M:1,251119_IBU_MCSearch:B;M:43,251118_IBU_XResultOpt:B;M:8,251119_IBU_MCSegDisp:B;M:47,251128_IBU_fic:B;M:26,251112_IBU_pxjygxtol:B;M:41,251124_IBU_lfp4:A;M:8,251215_IBU_lfca:A;M:65,251231_IBU_lda:C;",
        null,
        ""
    ],
    "ubtList": [
        [
            1,
            1769746869965,
            "pv",
            null,
            null
        ]
    ],
    "sendTs": 1769746870490
}

const a = `d=${encodePayload(JSON.stringify(c))}&ac=b`

console.log(a)