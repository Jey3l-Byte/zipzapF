// extra.js - all the NEW routes (student history, guard lists, visitor logbook, admin history)
// app.js loads this with:  require('./extra')(app, conn, onlyFor, alertGo);

module.exports = function(app, conn, onlyFor, alertGo){

    /* ---------------- small helpers ---------------- */

    // turn a Date into  YYYY-MM-DD HH:MM:SS  (empty if no date)
    function fmt(d){
        if(!d) return '';
        const x = new Date(d);
        const p = (n)=> String(n).padStart(2,'0');
        return x.getFullYear() + '-' + p(x.getMonth()+1) + '-' + p(x.getDate()) + ' ' +
               p(x.getHours()) + ':' + p(x.getMinutes()) + ':' + p(x.getSeconds());
    }

    // read a form value safely as trimmed text
    function val(x){
        return String(x === undefined || x === null ? '' : x).trim();
    }

    // so a typed % or _ is searched as a normal letter in LIKE
    function likeEscape(s){
        return s.replace(/[\\%_]/g, '\\$&');
    }

    // plate without spaces and dashes (for matching ABC 123 = ABC-123 = ABC123)
    function plateKey(s){
        return s.toUpperCase().replace(/[\s-]/g, '');
    }

    // same SQL idea as plateKey, for a column
    const PLATE_KEY_SQL = `REPLACE(REPLACE(plate,' ',''),'-','')`;

    // must be a real date like 2026-10-24, otherwise ''
    function validDate(s){
        s = val(s);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
        const d = new Date(s + 'T00:00:00Z');
        if(isNaN(d.getTime()) || d.toISOString().slice(0,10) !== s) return '';
        return s;
    }

    const ID_CHOICES = ["Driver's License","Passport","UMID","National ID","Company ID","Other Government ID","Other"];


    /* ======================================================
       FEATURE 1 - STUDENT: HISTORY OF MY OWN VEHICLES
       ====================================================== */

    app.get('/student/history', onlyFor('student'), (req,res)=>{
        // owner_id = the logged-in student, so nobody else's logs can show up
        const getdata = `SELECT l.action, l.log_time, v.plate, g.fullname AS guard_name
                         FROM tbl_gate_logs l
                         JOIN tbl_vehicles v ON l.vehicle_id = v.idnum
                         JOIN tbl_users g ON l.guard_id = g.idnum
                         WHERE v.owner_id = ?
                         ORDER BY l.idnum DESC
                         LIMIT 200`;

        conn.query(getdata,[req.session.user.idnum],(err,result)=>{
            if(err) throw err;
            res.render('student_history',{
                user: req.session.user,
                logs: result,
                fmt: fmt
            });
        });
    });


    /* ======================================================
       FEATURE 2A - GUARD: LIST OF REGISTERED (APPROVED) CARS
       ====================================================== */

    app.get('/guard/vehicles', onlyFor('guard'), (req,res)=>{
        const q = val(req.query.q).slice(0,100);
        const like = '%' + likeEscape(q) + '%';

        const getdata = `SELECT v.idnum, v.plate, v.type, v.brand, v.color, u.fullname,
                                (SELECT l.action FROM tbl_gate_logs l
                                 WHERE l.vehicle_id = v.idnum ORDER BY l.idnum DESC LIMIT 1) AS last_action,
                                (SELECT l.log_time FROM tbl_gate_logs l
                                 WHERE l.vehicle_id = v.idnum ORDER BY l.idnum DESC LIMIT 1) AS last_time
                         FROM tbl_vehicles v
                         JOIN tbl_users u ON v.owner_id = u.idnum
                         WHERE v.status = 'Approved'
                           AND (v.plate LIKE ? OR u.fullname LIKE ? OR v.brand LIKE ?)
                         ORDER BY v.plate`;

        conn.query(getdata,[like,like,like],(err,result)=>{
            if(err) throw err;
            res.render('guard_vehicles',{
                user: req.session.user,
                vehicle: result,
                q: q,
                fmt: fmt
            });
        });
    });


    /* ======================================================
       FEATURE 2B - GUARD: VISITOR LOGBOOK
       (visitors are NOT registered, their data stays in tbl_visitor_logs)
       ====================================================== */

    app.get('/guard/visitors', onlyFor('guard'), (req,res)=>{
        const getinside = `SELECT t.*, g.fullname AS guard_name
                           FROM tbl_visitor_logs t
                           JOIN tbl_users g ON t.guard_in = g.idnum
                           WHERE t.time_out IS NULL
                           ORDER BY t.time_in DESC`;

        const getleft = `SELECT t.*, g.fullname AS guard_name
                         FROM tbl_visitor_logs t
                         JOIN tbl_users g ON t.guard_in = g.idnum
                         WHERE t.time_out IS NOT NULL
                         ORDER BY t.time_out DESC, t.idnum DESC
                         LIMIT 20`;

        conn.query(getinside,(err,inside)=>{
            if(err) throw err;
            conn.query(getleft,(err,left)=>{
                if(err) throw err;
                res.render('guard_visitors',{
                    user: req.session.user,
                    inside: inside,
                    left: left,
                    idChoices: ID_CHOICES,
                    fmt: fmt
                });
            });
        });
    });

    // visitor time IN
    app.post('/visitor/in', onlyFor('guard'), (req,res)=>{
        const name = val(req.body.visitor_name);
        const plate = val(req.body.plate).toUpperCase();   // same format as vehicles: trimmed + uppercase
        const idshown = val(req.body.id_shown);
        const contact = val(req.body.contact);
        const person = val(req.body.person_visited);
        const purpose = val(req.body.purpose);

        // everything is required
        if(name === '' || plate === '' || idshown === '' || contact === '' || person === '' || purpose === ''){
            return alertGo(res,'PLEASE FILL IN ALL FIELDS!','/guard/visitors');
        }
        if(ID_CHOICES.indexOf(idshown) === -1){
            return alertGo(res,'INVALID ID TYPE!','/guard/visitors');
        }
        if(name.length > 100 || plate.length > 20 || contact.length > 30 || person.length > 100 || purpose.length > 150){
            return alertGo(res,'ONE OF THE FIELDS IS TOO LONG!','/guard/visitors');
        }
        // letters, numbers, space and dash only (keeps the plate safe to put in a link)
        if(!/^[A-Z0-9 -]+$/.test(plate) || plateKey(plate) === ''){
            return alertGo(res,'PLATE CAN ONLY HAVE LETTERS, NUMBERS, SPACE AND DASH!','/guard/visitors');
        }

        const key = plateKey(plate);

        // 1. is it a registered vehicle?
        const checkreg = `SELECT plate FROM tbl_vehicles WHERE ${PLATE_KEY_SQL} = ?`;

        conn.query(checkreg,[key],(err,reg)=>{
            if(err) throw err;
            if(reg.length > 0){
                return alertGo(res,'THIS PLATE IS A REGISTERED VEHICLE! USE THE GATE SEARCH.',
                    '/guard?plate=' + encodeURIComponent(reg[0].plate).replace(/'/g,'%27'));
            }

            // 2. is the same plate already inside?
            const checkinside = `SELECT idnum FROM tbl_visitor_logs
                                 WHERE time_out IS NULL AND ${PLATE_KEY_SQL} = ?`;

            conn.query(checkinside,[key],(err,already)=>{
                if(err) throw err;
                if(already.length > 0){
                    return alertGo(res,'THIS VISITOR PLATE IS ALREADY INSIDE!','/guard/visitors');
                }

                // 3. save it
                const insert = `INSERT INTO tbl_visitor_logs
                                (visitor_name,plate,id_shown,contact,person_visited,purpose,guard_in)
                                VALUES(?,?,?,?,?,?,?)`;

                conn.query(insert,[name,plate,idshown,contact,person,purpose,req.session.user.idnum],(err)=>{
                    if(err) throw err;
                    alertGo(res,'VISITOR TIME IN RECORDED!','/guard/visitors');
                });
            });
        });
    });

    // visitor time OUT
    app.post('/visitor/out', onlyFor('guard'), (req,res)=>{
        const id = parseInt(req.body.id, 10);

        if(isNaN(id)){
            return alertGo(res,'INVALID VISITOR!','/guard/visitors');
        }

        // time_out IS NULL in the WHERE so a visitor can only be timed out once
        const update = `UPDATE tbl_visitor_logs SET time_out = NOW(), guard_out = ?
                        WHERE idnum = ? AND time_out IS NULL`;

        conn.query(update,[req.session.user.idnum,id],(err,result)=>{
            if(err) throw err;
            if(result.affectedRows === 0){
                return alertGo(res,'VISITOR WAS ALREADY TIMED OUT!','/guard/visitors');
            }
            alertGo(res,'VISITOR TIME OUT RECORDED!','/guard/visitors');
        });
    });


    /* ======================================================
       FEATURE 3 - ADMIN: ONE MERGED HISTORY (+ CSV)
       ====================================================== */

    // read + validate the filters from the link (?type=&from=&to=&q=)
    function readFilters(query){
        let type = val(query.type);
        if(type !== 'Registered' && type !== 'Visitor') type = 'all';

        return {
            type: type,
            from: validDate(query.from),
            to: validDate(query.to),
            q: val(query.q).slice(0,100)
        };
    }

    // build the merged SQL (registered ENTRY/EXIT + visitor IN/OUT) with the filters
    function historySql(f, limit){
        const params = [];
        const where = [];

        if(f.type !== 'all'){
            where.push('kind = ?');
            params.push(f.type);
        }
        if(f.from !== ''){
            where.push('event_time >= ?');
            params.push(f.from + ' 00:00:00');
        }
        if(f.to !== ''){
            where.push('event_time < DATE_ADD(?, INTERVAL 1 DAY)');
            params.push(f.to + ' 00:00:00');
        }
        if(f.q !== ''){
            const key = likeEscape(plateKey(f.q));
            if(key !== ''){
                where.push(`(${PLATE_KEY_SQL} LIKE ? OR name LIKE ?)`);
                params.push('%' + key + '%', '%' + likeEscape(f.q) + '%');
            } else {
                where.push('name LIKE ?');
                params.push('%' + likeEscape(f.q) + '%');
            }
        }

        let sql = `SELECT * FROM (
                      SELECT l.log_time AS event_time, 'Registered' AS kind, v.plate AS plate,
                             o.fullname AS name, l.action AS action, g.fullname AS guard,
                             NULL AS person_visited, NULL AS purpose, NULL AS id_shown, NULL AS contact,
                             l.idnum AS src_id
                      FROM tbl_gate_logs l
                      JOIN tbl_vehicles v ON l.vehicle_id = v.idnum
                      JOIN tbl_users o ON v.owner_id = o.idnum
                      JOIN tbl_users g ON l.guard_id = g.idnum

                      UNION ALL

                      SELECT t.time_in, 'Visitor', t.plate, t.visitor_name, 'ENTRY', g.fullname,
                             t.person_visited, t.purpose, t.id_shown, t.contact, t.idnum
                      FROM tbl_visitor_logs t
                      JOIN tbl_users g ON t.guard_in = g.idnum

                      UNION ALL

                      SELECT t.time_out, 'Visitor', t.plate, t.visitor_name, 'EXIT', g.fullname,
                             t.person_visited, t.purpose, t.id_shown, t.contact, t.idnum
                      FROM tbl_visitor_logs t
                      JOIN tbl_users g ON t.guard_out = g.idnum
                      WHERE t.time_out IS NOT NULL
                   ) AS h`;

        if(where.length > 0){
            sql += ' WHERE ' + where.join(' AND ');
        }
        sql += ' ORDER BY event_time DESC, src_id DESC';

        if(limit){
            sql += ' LIMIT ' + parseInt(limit,10);
        }
        return {sql: sql, params: params};
    }

    // text for the "details" column (only visitors have details)
    function detailsText(r){
        if(r.kind !== 'Visitor') return '';
        return 'Visited: ' + r.person_visited + ' | Purpose: ' + r.purpose +
               ' | ID: ' + r.id_shown + ' | Contact: ' + r.contact;
    }

    app.get('/admin/history', onlyFor('admin'), (req,res)=>{
        const f = readFilters(req.query);
        const built = historySql(f, 500);

        // who is inside right now
        const getreg = `SELECT v.plate, o.fullname AS name, l.log_time AS since
                        FROM tbl_vehicles v
                        JOIN tbl_users o ON v.owner_id = o.idnum
                        JOIN tbl_gate_logs l ON l.vehicle_id = v.idnum
                        WHERE l.action = 'ENTRY'
                          AND l.idnum = (SELECT MAX(x.idnum) FROM tbl_gate_logs x WHERE x.vehicle_id = v.idnum)`;
        const getvis = `SELECT plate, visitor_name AS name, time_in AS since, person_visited
                        FROM tbl_visitor_logs WHERE time_out IS NULL`;

        conn.query(built.sql,built.params,(err,rows)=>{
            if(err) throw err;
            conn.query(getreg,(err,reg)=>{
                if(err) throw err;
                conn.query(getvis,(err,vis)=>{
                    if(err) throw err;

                    const inside = [];
                    reg.forEach((r)=>{
                        inside.push({kind:'Registered', plate:r.plate, name:r.name, since:r.since, note:''});
                    });
                    vis.forEach((r)=>{
                        inside.push({kind:'Visitor', plate:r.plate, name:r.name, since:r.since, note:'Visiting: ' + r.person_visited});
                    });
                    inside.sort((a,b)=> new Date(b.since) - new Date(a.since));

                    rows.forEach((r)=>{ r.details = detailsText(r); });

                    // link for the Export CSV button (keeps the filters)
                    const qs = new URLSearchParams();
                    if(f.type !== 'all') qs.set('type', f.type);
                    if(f.from !== '') qs.set('from', f.from);
                    if(f.to !== '') qs.set('to', f.to);
                    if(f.q !== '') qs.set('q', f.q);
                    const exportUrl = '/admin/history.csv' + (qs.toString() ? '?' + qs.toString() : '');

                    res.render('admin_history',{
                        user: req.session.user,
                        rows: rows,
                        inside: inside,
                        f: f,
                        exportUrl: exportUrl,
                        truncated: rows.length >= 500,
                        fmt: fmt
                    });
                });
            });
        });
    });

    // one CSV cell: always quoted, and a leading = + - @ gets a ' in front
    // so Excel does not run it as a formula
    function csvCell(x){
        let s = (x === undefined || x === null) ? '' : String(x);
        if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g,'""') + '"';
    }

    app.get('/admin/history.csv', onlyFor('admin'), (req,res)=>{
        const f = readFilters(req.query);
        const built = historySql(f, 0);      // 0 = no limit

        conn.query(built.sql,built.params,(err,rows)=>{
            if(err) throw err;

            const lines = [];
            lines.push(['Date & Time','Type','Plate','Name','Action','Guard','Details']
                .map(csvCell).join(','));

            rows.forEach((r)=>{
                lines.push([fmt(r.event_time), r.kind, r.plate, r.name, r.action, r.guard, detailsText(r)]
                    .map(csvCell).join(','));
            });

            res.setHeader('Content-Type','text/csv; charset=utf-8');
            res.setHeader('Content-Disposition','attachment; filename="gate_history.csv"');
            res.send('\uFEFF' + lines.join('\r\n') + '\r\n');    // \uFEFF = BOM so Excel reads UTF-8
        });
    });

};
